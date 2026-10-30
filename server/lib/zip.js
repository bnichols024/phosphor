// Reads a zip's central directory (names, sizes, CRC32s) without unpacking it, and pulls single
// small entries out for header sniffing. Enough to identify zipped ROMs by checksum for free.
import fsp from "node:fs/promises";
import zlib from "node:zlib";

export async function listZip(file) {
  const fh = await fsp.open(file, "r");
  try {
    const { size } = await fh.stat();
    const tail = Math.min(size, 65557);
    const buf = Buffer.alloc(tail);
    await fh.read(buf, 0, tail, size - tail);
    let eocd = -1;
    for (let i = tail - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOff = buf.readUInt32LE(eocd + 16);
    if (cdOff + cdSize > size || cdSize > 64 * 1024 * 1024) return null;
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOff);
    const entries = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      const csize = cd.readUInt32LE(p + 20);
      const usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28);
      const elen = cd.readUInt16LE(p + 30);
      const clen = cd.readUInt16LE(p + 32);
      const local = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nlen);
      p += 46 + nlen + elen + clen;
      if (name.endsWith("/")) continue;
      entries.push({ name, method, crc: crc.toString(16).toUpperCase().padStart(8, "0"), csize, usize, local });
    }
    return entries;
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

// Returns the first `limit` bytes of an entry (whole entry if smaller). Only stored/deflated.
export async function readZipEntry(file, entry, limit = Infinity) {
  if (entry.csize > 256 * 1024 * 1024) return null;
  const fh = await fsp.open(file, "r");
  try {
    const lh = Buffer.alloc(30);
    await fh.read(lh, 0, 30, entry.local);
    if (lh.readUInt32LE(0) !== 0x04034b50) return null;
    const start = entry.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const want = entry.method === 0 ? Math.min(entry.csize, limit) : entry.csize;
    const data = Buffer.alloc(want);
    await fh.read(data, 0, want, start);
    if (entry.method === 0) return data;
    if (entry.method === 8) {
      const out = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, Math.min(entry.usize, 512 * 1024 * 1024)) });
      return limit < out.length ? out.subarray(0, limit) : out;
    }
    return null;
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}
