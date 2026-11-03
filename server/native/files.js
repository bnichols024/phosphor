// Small helpers for the desktop emulators: reading PlayStation PARAM.SFO files, recognising the
// files players bring themselves (PS2 BIOS, Switch keys, Xbox BIOS, Sony firmware), editing INI
// settings files, and where each emulator keeps its data on each OS.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ---- PARAM.SFO (PS3, PS4, Vita game info) ----
export function parseSfo(buf) {
  if (!buf || buf.length < 20 || buf.readUInt32LE(0) !== 0x46535000) return null; // "\0PSF"
  const keyTable = buf.readUInt32LE(8), dataTable = buf.readUInt32LE(12), count = buf.readUInt32LE(16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const e = 20 + i * 16;
    if (e + 16 > buf.length) break;
    const keyOff = buf.readUInt16LE(e), fmt = buf.readUInt16LE(e + 2), len = buf.readUInt32LE(e + 4), dataOff = buf.readUInt32LE(e + 12);
    const ks = keyTable + keyOff;
    const key = buf.toString("latin1", ks, buf.indexOf(0, ks));
    const d = dataTable + dataOff;
    if (fmt === 0x0404) out[key] = buf.readUInt32LE(d);
    else out[key] = buf.toString("utf8", d, d + len).replace(/\0+$/, "");
  }
  return out;
}
export async function readSfo(file) {
  try { return parseSfo(await fsp.readFile(file)); } catch { return null; }
}

// ---- files players bring ----
const readHead = async (file, n) => {
  const fh = await fsp.open(file, "r");
  try { const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, 0); return b.subarray(0, bytesRead); } finally { await fh.close(); }
};

// files: [{ file, name (lower-case), size }] from the BIOS folder. Returns what each console has.
export async function detectSystemFiles(files, { exclude = new Set() } = {}) {
  const byName = (re) => files.find((f) => re.test(f.name));
  const out = {};
  // PS2 BIOS: a 4 MB dump whose ROM directory lists RESET/ROMVER.
  let ps2 = null;
  for (const f of files.filter((x) => x.size >= 4 * 1024 * 1024 && x.size <= 16 * 1024 * 1024 && /\.(bin|rom|ps2|img)$/.test(x.name))) {
    const head = await readHead(f.file, 0x10000).catch(() => null);
    if (head && head.includes("ROMDIR", 0, "latin1") && head.includes("ROMVER", 0, "latin1")) { ps2 = f.file; break; }
  }
  out.ps2 = { ready: !!ps2, files: { bios: ps2 } };
  // Xbox: the 512-byte MCPX boot ROM plus a 256 KB or 1 MB flash BIOS.
  const mcpx = files.find((f) => f.size === 512 && /mcpx/.test(f.name)) || files.find((f) => f.size === 512 && /\.bin$/.test(f.name) && !exclude.has(f.name));
  const flash = files.find((f) => (f.size === 262144 || f.size === 1048576) && /\.bin$/.test(f.name) && !exclude.has(f.name) && f !== mcpx);
  out.xbox = { ready: !!(mcpx && flash), files: { mcpx: mcpx?.file || null, flash: flash?.file || null } };
  // Switch: keys dumped from the player's own console.
  const prod = byName(/^prod\.keys$/), title = byName(/^title\.keys$/);
  out.switch = { ready: !!prod, files: { prodKeys: prod?.file || null, titleKeys: title?.file || null } };
  // Switch 2 (Eglantine): unpacked games run without keys; keys are passed on if the player has them.
  out.switch2 = { ready: true, files: { prodKeys: prod?.file || null, titleKeys: title?.file || null } };
  // PS3 / Vita: Sony's free system software files.
  const ps3 = byName(/^ps3updat\.pup$/);
  out.ps3 = { ready: !!ps3, files: { firmware: ps3?.file || null } };
  // Vita: the system software (PSVUPDAT.PUP) and the font package Vita3K also needs. Sony names
  // the font package and the optional pre-install package both PSP2UPDAT.PUP; the font package is
  // the small one (about 57 MB, the other about 129 MB). Windows' "(1)" copies count too.
  const vitaPup = (stem) => files.filter((f) => new RegExp(`^${stem}( ?\\(\\d+\\))?\\.pup$`).test(f.name));
  const vita = vitaPup("psvupdat")[0];
  const p2 = vitaPup("psp2updat");
  const font = p2.find((f) => f.size < 100 * 1024 * 1024), pre = p2.find((f) => f.size >= 100 * 1024 * 1024);
  out.vita = { ready: !!(vita && font), files: { firmware: vita?.file || null, fonts: font?.file || null, preinst: pre?.file || null }, optional: ["preinst"] };
  // Wii U: keys only matter for encrypted dumps, so never a lock.
  const wiiu = byName(/^keys\.txt$/);
  out.wiiu = { ready: true, files: { keys: wiiu?.file || null } };
  return out;
}

// Names that mean "this belongs in the BIOS folder" when dropped anywhere.
export const SYSTEM_FILE_NAMES = /^(prod\.keys|title\.keys|keys\.txt|ps3updat\.pup|(psvupdat|psp2updat)( ?\(\d+\))?\.pup|mcpx.*\.bin)$/i;

// What each detected file is, for the BIOS page and lock messages.
export const SYSTEM_FILE_LABELS = {
  bios: "PS2 BIOS", mcpx: "Xbox MCPX boot ROM", flash: "Xbox flash BIOS", prodKeys: "prod.keys", titleKeys: "title.keys (optional)",
  keys: "keys.txt (only for encrypted dumps)", firmware: "System software", fonts: "Font package (PSP2UPDAT.PUP, about 57 MB)",
  preinst: "Pre-install package (optional)",
};

// ---- INI files (PCSX2, ...) ----
// Sets keys in an INI file, keeping everything else the player configured. Qt-based emulators
// (Eden, Azahar) want "key=value" without spaces: pass { sep: "=" }.
export function mergeIni(file, values, { sep = " = " } = {}) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = text.split(/\r?\n/);
  for (const [section, keys] of Object.entries(values)) {
    let start = lines.findIndex((l) => l.trim() === `[${section}]`);
    if (start < 0) { if (lines.length && lines.at(-1) !== "") lines.push(""); lines.push(`[${section}]`); start = lines.length - 1; }
    let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
    if (end < 0) end = lines.length;
    for (const [k, v] of Object.entries(keys)) {
      const i = lines.findIndex((l, j) => j > start && j < end && l.split("=")[0].trim() === k);
      if (i >= 0) lines[i] = `${k}${sep}${v}`;
      else { lines.splice(end, 0, `${k}${sep}${v}`); end++; }
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"));
}

// Where an emulator keeps its own data when we can't point it somewhere else. On Linux we set
// XDG_DATA_HOME/XDG_CONFIG_HOME to a Phosphor folder, so those cases come back with that path.
export function appDataDir(platform, name, { xdg = null, kind = "data" } = {}) {
  if (platform === "linux") return path.join(xdg || path.join(os.homedir(), kind === "config" ? ".config" : ".local/share"), name);
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", name);
  return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), name);
}

export function copyIfChanged(src, dest) {
  if (!src) return;
  try {
    const a = fs.statSync(src);
    const b = fs.existsSync(dest) ? fs.statSync(dest) : null;
    if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  } catch { /* the emulator reports what's missing */ }
}

// The key=value lines of one INI section (values as written, quotes included).
export function readIniSection(file, section) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const out = {};
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (/^\[.*\]$/.test(t)) { inside = t === `[${section}]`; continue; }
    if (!inside || !t || t.startsWith(";") || t.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
