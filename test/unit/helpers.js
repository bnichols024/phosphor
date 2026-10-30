import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

export function tmpdir(prefix = "phosphor-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Minimal stored (uncompressed) zip writer for fixtures.
export function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const buf = Buffer.from(data);
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(buf) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(buf.length, 18); lh.writeUInt32LE(buf.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, buf);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(buf.length, 20); ch.writeUInt32LE(buf.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + buf.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8); eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

// Minimal ustar writer for fixtures.
export function makeTar(entries) {
  const blocks = [];
  for (const [name, data] of Object.entries(entries)) {
    const buf = Buffer.from(data);
    const h = Buffer.alloc(512);
    h.write(name, 0, 100);
    h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
    h.write(buf.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.write("        ", 148);
    h.write("0", 156);
    h.write("ustar\0", 257); h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(h, buf, Buffer.alloc((512 - (buf.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

export function nesRom(prgBanks = 2) {
  const header = Buffer.from([0x4e, 0x45, 0x53, 0x1a, prgBanks, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const body = Buffer.alloc(prgBanks * 16384 + 8192, 0xea);
  return Buffer.concat([header, body]);
}

export function genesisRom() {
  const b = Buffer.alloc(0x20000, 0);
  b.write("SEGA GENESIS    ", 0x100, "latin1");
  return b;
}

// Raw 2352-byte-sector disc image whose first data sector starts with `marker`.
export function rawDisc(marker, { pvdSystem = null, sectors = 20 } = {}) {
  const buf = Buffer.alloc(sectors * 2352, 0);
  for (let s = 0; s < sectors; s++) {
    const o = s * 2352;
    buf[o] = 0; buf.fill(0xff, o + 1, o + 11); buf[o + 11] = 0; buf[o + 15] = 1;
  }
  if (marker) buf.write(marker, 0x10, "latin1");
  if (pvdSystem) {
    const p = 16 * 2352 + 0x10;
    buf[p] = 1; buf.write("CD001", p + 1, "latin1"); buf.write(pvdSystem.padEnd(32, " "), p + 8, "latin1");
  }
  return buf;
}
