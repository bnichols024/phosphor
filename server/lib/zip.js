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
    let count = buf.readUInt16LE(eocd + 10);
    let cdSize = buf.readUInt32LE(eocd + 12);
    let cdOff = buf.readUInt32LE(eocd + 16);
    // ZIP64 (archives over 4 GB or 65535 files): the real values are in the ZIP64 end record,
    // found through the locator just before the normal one.
    if ((count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) && eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) {
      const rec = Buffer.alloc(56);
      await fh.read(rec, 0, 56, Number(buf.readBigUInt64LE(eocd - 12)));
      if (rec.readUInt32LE(0) !== 0x06064b50) return null;
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOff = Number(rec.readBigUInt64LE(48));
    }
    if (cdOff + cdSize > size || cdSize > 64 * 1024 * 1024) return null;
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOff);
    const entries = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      let csize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28);
      const elen = cd.readUInt16LE(p + 30);
      const clen = cd.readUInt16LE(p + 32);
      let local = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nlen);
      // ZIP64 extra field (id 1): 64-bit values for whichever of the three are 0xffffffff, in order.
      for (let x = p + 46 + nlen, end = x + elen; x + 4 <= end;) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 1) {
          let q = x + 4;
          const next = () => { const v = q + 8 <= x + 4 + len ? Number(cd.readBigUInt64LE(q)) : null; q += 8; return v; };
          if (usize === 0xffffffff) usize = next() ?? usize;
          if (csize === 0xffffffff) csize = next() ?? csize;
          if (local === 0xffffffff) local = next() ?? local;
          break;
        }
        x += 4 + len;
      }
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
