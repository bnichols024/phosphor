// Minimal .tar / .tar.gz reader, enough for npm package tarballs (ustar + pax long names).
import { gunzipSync } from "node:zlib";

function str(buf, start, len) {
  const end = buf.indexOf(0, start);
  return buf.toString("utf8", start, end === -1 || end > start + len ? start + len : end);
}

function octal(buf, start, len) {
  const s = str(buf, start, len).trim();
  return s ? parseInt(s, 8) : 0;
}

function parsePax(data) {
  const out = {};
  let i = 0;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i);
    if (sp === -1) break;
    const len = parseInt(data.toString("utf8", i, sp), 10);
    if (!len) break;
    const rec = data.toString("utf8", sp + 1, i + len - 1);
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

// Returns [{ name, type: "file"|"dir", data }]. Names are normalised and never escape the root.
export function readTar(input) {
  const buf = input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input) : input;
  const entries = [];
  let off = 0;
  let pax = null;
  let longName = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    let name = str(header, 0, 100);
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const magic = str(header, 257, 6);
    if (magic.startsWith("ustar")) {
      const prefix = str(header, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const dataStart = off + 512;
    const data = buf.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / 512) * 512;

    if (type === "x") { pax = parsePax(data); continue; }
    if (type === "g") continue;
    if (type === "L") { longName = str(data, 0, data.length); continue; }
    if (pax?.path) name = pax.path;
    if (longName) name = longName;
    pax = null;
    longName = null;

    const safe = name.split("/").filter((p) => p && p !== "." && p !== "..").join("/");
    if (!safe) continue;
    if (type === "5") entries.push({ name: safe, type: "dir", data: null });
    else if (type === "0" || type === "\0" || type === "7") entries.push({ name: safe, type: "file", data: Buffer.from(data) });
  }
  return entries;
}
