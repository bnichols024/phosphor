// Works out what a file is: which system it belongs to (from its folder, extension, header bytes,
// zip contents or checksum) and which game it is (checksum, disc serial, filename, fuzzy title).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { BY_ID, EXT_INDEX, SYSTEMS } from "./systems.js";
import { listZip, readZipEntry } from "./lib/zip.js";
import { parseName, normTitle } from "./gamedb.js";

const MAX_HASH = 96 * 1024 * 1024; // checksum anything up to 96 MB (every cartridge game)

export async function crcFile(file, skip = 0) {
  return new Promise((resolve, reject) => {
    let crc = 0;
    fs.createReadStream(file, { start: skip, highWaterMark: 1 << 20 })
      .on("data", (chunk) => { crc = zlib.crc32(chunk, crc); })
      .on("end", () => resolve((crc >>> 0).toString(16).toUpperCase().padStart(8, "0")))
      .on("error", reject);
  });
}

async function readHead(file, len, pos = 0) {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, pos);
    return buf.subarray(0, bytesRead);
  } finally { await fh.close(); }
}

const ascii = (buf, start, len) => buf.toString("latin1", start, start + len);
const isCdSync = (b) => b.length >= 12 && b[0] === 0 && b[11] === 0 && b.subarray(1, 11).every((x) => x === 0xff);

// Disc image (iso/bin/img) -> system id, or null.
async function sniffDisc(file) {
  const head = await readHead(file, 0x9400);
  if (!head.length) return null;
  const raw = isCdSync(head);
  const data0 = raw ? (head[15] === 2 ? 0x18 : 0x10) : 0;
  const s0 = ascii(head, data0, 32);
  if (s0.startsWith("SEGADISCSYSTEM")) return "segacd";
  if (s0.startsWith("SEGA SEGASATURN")) return "saturn";
  // ISO9660 primary volume descriptor lives in sector 16.
  const pvd = raw ? 16 * 2352 + data0 : 16 * 2048;
  const pvdBuf = await readHead(file, 64, pvd);
  const sysId = ascii(pvdBuf, 8, 32).trim();
  if (sysId === "PSP GAME") return "psp";
  if (sysId === "PLAYSTATION") return "psx";
  if (ascii(pvdBuf, 1, 5) === "CD001" && raw) {
    // Sony licence text sits in sector 4 of PlayStation discs.
    const lic = await readHead(file, 128, 4 * 2352 + data0);
    if (ascii(lic, 0, 128).includes("Sony Computer Entertainment")) return "psx";
  }
  if (raw) {
    // PC Engine CD: data track carries "PC Engine CD-ROM SYSTEM" early on.
    const big = await readHead(file, 64 * 2352);
    if (big.includes("PC Engine CD-ROM SYSTEM", 0, "latin1")) return "pcecd";
  }
  return null;
}

// PlayStation / PSP disc serial (e.g. SLUS00594) from the first few MB, for exact matching.
async function sniffSerial(file, system) {
  try {
    const head = await readHead(file, 4 * 1024 * 1024);
    const text = head.toString("latin1");
    if (system === "psx") {
      const m = text.match(/cdrom0?:\\?\\?([A-Z]{4})[_-](\d{3})\.(\d{2})/i);
      if (m) return `${m[1]}${m[2]}${m[3]}`.toUpperCase();
    }
    if (system === "psp") {
      const m = text.match(/\b(U[LC][UEJAK][SM]|NP[UEJH][GHZ])-?(\d{5})\b/);
      if (m) return `${m[1]}${m[2]}`;
    }
  } catch { /* unreadable: no serial */ }
  return null;
}

function cueFiles(text, dir) {
  return [...text.matchAll(/^\s*FILE\s+"?(.+?)"?\s+(BINARY|MOTOROLA|WAVE|MP3|AIFF|OGG)?\s*$/gim)].map((m) => path.join(dir, m[1].trim()));
}

export async function referencedFiles(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const dir = path.dirname(file);
  try {
    const text = await fsp.readFile(file, "utf8");
    if (ext === "cue") return cueFiles(text, dir);
    if (ext === "ccd") return [file.replace(/\.ccd$/i, ".img"), file.replace(/\.ccd$/i, ".sub")];
    if (ext === "m3u") {
      const out = [];
      for (const line of text.split(/\r?\n/)) {
        const l = line.trim();
        if (!l || l.startsWith("#")) continue;
        const p = path.join(dir, l);
        out.push(p);
        if (/\.cue$/i.test(l)) out.push(...(await referencedFiles(p).catch(() => [])));
      }
      return out;
    }
  } catch { /* missing companion: caller handles */ }
  return [];
}

// Header checks for ambiguous cartridge extensions (.bin/.rom) and zip contents.
function sniffCart(buf, size) {
  if (buf.length >= 0x110) {
    const h = ascii(buf, 0x100, 16);
    if (h.startsWith("SEGA 32X")) return "32x";
    if (h.startsWith("SEGA")) return "genesis";
  }
  if (ascii(buf, 0, 4) === "NES\x1a") return "nes";
  if (ascii(buf, 1, 9) === "ATARI7800") return "atari7800";
  if (ascii(buf, 0, 4) === "LYNX") return "lynx";
  if (size <= 64 * 1024 && [2048, 4096, 8192, 12288, 16384, 32768, 65536].includes(size)) return "atari2600";
  return null;
}

function isCompanionOnly(ext) { return ["bin", "img", "sub", "wav", "ogg", "mp3", "ecm"].includes(ext); }

// Main entry. Returns null when the file isn't a game on its own.
// { system, crc, serial, discSystem, match: {name,...}|null, files: [abs paths], reason }
export async function identify(file, { folderSystem = null, gamedb, arcadeHint = false } = {}) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const st = await fsp.stat(file);
  const base = path.basename(file, path.extname(file));
  let system = null;
  let reason = "";
  let crc = null;
  let serial = null;
  let files = [file];
  const claim = EXT_INDEX[ext] || [];

  // 0. PlayStation programs (homebrew) use .exe too: tell them from DOS by their header.
  if (ext === "exe") {
    const head = await readHead(file, 8);
    if (ascii(head, 0, 8) === "PS-X EXE") { system = "psx"; reason = "header"; }
  }

  // 1. Extension that only one system uses.
  if (!system && claim.length === 1) { system = claim[0]; reason = "extension"; }
  else if (claim.length > 1 && folderSystem && claim.includes(folderSystem)) { system = folderSystem; reason = "folder"; }

  // 2. Disc formats.
  if (!system && ["cue", "m3u", "ccd", "iso", "img", "bin", "chd", "pbp", "toc", "mds", "cso"].includes(ext)) {
    if (["cue", "m3u", "ccd"].includes(ext)) {
      files = [file, ...(await referencedFiles(file))];
      const firstData = files.find((f) => /\.(bin|img|iso)$/i.test(f) && fs.existsSync(f));
      if (firstData) {
        const d = await sniffDisc(firstData).catch(() => null);
        if (d) { system = d; reason = "disc header"; }
      }
      if (!system && folderSystem && BY_ID[folderSystem]?.disc) { system = folderSystem; reason = "folder"; }
    } else if (["iso", "img", "bin"].includes(ext)) {
      const d = await sniffDisc(file).catch(() => null);
      if (d) { system = d; reason = "disc header"; }
    } else if (ext === "pbp") {
      const head = await readHead(file, 0x400000).catch(() => Buffer.alloc(0));
      system = head.includes("PSISOIMG", 0, "latin1") || head.includes("PSTITLEIMG", 0, "latin1") ? "psx" : "psp";
      reason = "eboot";
    } else if (ext === "cso") { system = "psp"; reason = "extension"; }
    if (!system && folderSystem && BY_ID[folderSystem] && (BY_ID[folderSystem].discExts || []).includes(ext)) { system = folderSystem; reason = "folder"; }
    if (system === "psx" || system === "psp") {
      const dataFile = ext === "cue" || ext === "m3u" ? files.find((f) => /\.(bin|img|iso)$/i.test(f)) : file;
      if (dataFile && fs.existsSync(dataFile) && !/\.chd$/i.test(dataFile)) serial = await sniffSerial(dataFile, system);
    }
  }

  // 3. Zip / 7z: arcade set, DOS game, or a zipped cartridge.
  let zipEntries = null;
  if (!system && (ext === "zip" || ext === "7z")) {
    if (ext === "zip") zipEntries = await listZip(file);
    const inner = (zipEntries || []).map((e) => ({ ...e, ext: path.extname(e.name).slice(1).toLowerCase() }));
    const arcadeName = gamedb.byFile("arcade", base);
    const cart = inner.find((e) => (EXT_INDEX[e.ext] || []).length === 1);
    if (folderSystem === "arcade" || (arcadeHint && arcadeName)) { system = "arcade"; reason = "arcade set"; }
    else if (folderSystem === "dos" || inner.some((e) => ["exe", "com", "bat"].includes(e.ext))) {
      if (folderSystem === "dos" || !cart) { system = "dos"; reason = "dos program"; }
    }
    if (!system && cart) { system = EXT_INDEX[cart.ext][0]; crc = cart.crc; reason = "zip contents"; }
    if (!system && folderSystem && folderSystem !== "arcade") { system = folderSystem; reason = "folder"; }
    if (!system && arcadeName) { system = "arcade"; reason = "arcade set"; }
    if (!system) {
      // A disk or tape image several computers share (.d64, .prg, .tzx…): the checksum decides.
      const shared = inner.find((e) => (EXT_INDEX[e.ext] || []).length > 1 && BY_ID[EXT_INDEX[e.ext][0]].kind === "computer");
      if (shared) { const ids = EXT_INDEX[shared.ext]; system = ids.find((id) => gamedb.byCrc(id, shared.crc)) || ids[0]; crc = shared.crc; reason = "zip contents"; }
    }
    if (!system && inner.length) {
      const bin = inner.find((e) => ["bin", "rom", "md", "gen"].includes(e.ext));
      if (bin) {
        const head = await readZipEntry(file, bin, 0x200);
        const s = head && sniffCart(head, bin.usize);
        if (s) { system = s; crc = bin.crc; reason = "zip header"; }
      }
    }
    if (system && system !== "arcade" && system !== "dos" && !crc && inner.length === 1) crc = inner[0].crc;
  }

  // 4. Ambiguous cartridge extensions.
  if (!system && ["bin", "rom", "a52"].includes(ext)) {
    const head = await readHead(file, 0x200);
    system = sniffCart(head, st.size);
    if (system) reason = "header";
  }

  // 5. Small computer formats shared by two systems.
  if (!system && ext === "tap") {
    const head = await readHead(file, 12);
    system = ascii(head, 0, 12) === "C64-TAPE-RAW" ? "c64" : "zxspectrum";
    reason = "header";
  }
  if (!system && ext === "sna") {
    const head = await readHead(file, 8);
    system = ascii(head, 0, 8) === "MV - SNA" ? "cpc" : "zxspectrum";
    reason = "header";
  }

  if (!system && folderSystem) {
    const fs_ = BY_ID[folderSystem];
    if (fs_ && (ext === "zip" || ext === "7z" || fs_.exts.includes(ext) || (fs_.discExts || []).includes(ext))) { system = folderSystem; reason = "folder"; }
  }

  // 6. Extensions several computers share (.d64 is C64, C128, VIC-20, Plus/4 or PET): a known
  // checksum decides, otherwise the most common machine (listed first) gets it.
  if (!system && claim.length > 1) {
    if (st.size <= MAX_HASH) { crc = await crcFile(file); system = claim.find((id) => gamedb.byCrc(id, crc)) || null; }
    system ||= claim[0];
    reason = "extension";
  }
  if (!system) return null;
  if (isCompanionOnly(ext) && BY_ID[system]?.disc) {
    // A bare .bin of a disc game only counts if no cue points at it (caller filters companions).
    reason += "+bare";
  }

  // Checksum cartridge games (cheap, exact match against No-Intro).
  const sys = BY_ID[system];
  let match = null;
  if (!sys.disc && !sys.arcade && system !== "dos") {
    if (!crc && st.size <= MAX_HASH && !["zip", "7z"].includes(ext)) crc = await crcFile(file);
    if (crc) match = gamedb.byCrc(system, crc);
    if (!match && sys.headerSkip && !["zip", "7z"].includes(ext) && st.size > sys.headerSkip && st.size <= MAX_HASH) {
      const alt = await crcFile(file, sys.headerSkip);
      match = gamedb.byCrc(system, alt);
      if (match) crc = alt;
    }
    // A header-sniffed .bin can belong to a neighbour (2600 vs 5200 vs 7800): trust the checksum.
    if (!match && crc && reason === "header") {
      for (const other of ["atari2600", "atari5200", "atari7800", "genesis", "32x"]) {
        const m = gamedb.byCrc(other, crc);
        if (m) { system = other; match = m; break; }
      }
    }
  }
  if (!match && serial) {
    match = gamedb.bySerial(system, serial);
    // Homebrew built with the PSP SDK carries its default disc id (LocoRoco's), and other
    // eboots reuse ids too: only trust an eboot's serial when the file name roughly agrees.
    if (match && (serial === "UCJS10041" || ext === "pbp")) {
      const words = new Set(normTitle(parseName(base).title).split(" ").filter((w) => w.length > 2));
      if (serial === "UCJS10041" || !normTitle(parseName(match.name).title).split(" ").some((w) => words.has(w))) match = null;
    }
  }
  if (!match && (sys.disc || sys.arcade) && ext !== "chd" && st.size <= 1024 * 1024 * 1024 && ["bin", "iso", "img"].includes(ext)) {
    // Redump lists data-track checksums; worth it for single-file images only.
    match = gamedb.byCrc(system, await crcFile(file));
  }
  if (!match) match = gamedb.byFile(system, base);
  if (!match) {
    const p = parseName(base);
    match = gamedb.byTitle(system, p.title);
  }
  return { system, crc, serial, match, files, reason, size: st.size, mtime: Math.floor(st.mtimeMs), zipEntries };
}

export const SYSTEM_IDS = SYSTEMS.map((s) => s.id);
