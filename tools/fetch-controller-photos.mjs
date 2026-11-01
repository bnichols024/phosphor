#!/usr/bin/env node
// Downloads a real photo of each console's controller (or the device itself, for handhelds and home
// computers) from Wikimedia Commons, cuts it out of its white background, and writes a transparent
// WebP to web/img/controllers/<system>.webp plus CREDITS.md. Only freely licensed photos are accepted
// (public domain, CC0, CC BY, CC BY-SA); anything else stops the script. The results are committed,
// so building Phosphor never needs this script or the network.
//
//   node tools/fetch-controller-photos.mjs            all systems
//   node tools/fetch-controller-photos.mjs nes snes   just these
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { BY_ID } from "../server/systems.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "web/img/controllers");
const UA = "Phosphor/1.7 (retro gaming app; https://github.com/bnichols024/phosphor)";

// system id -> Commons file. Most are Evan-Amos's public-domain studio photos.
export const PHOTOS = {
  nes: "Nintendo-Entertainment-System-NES-Controller-FL.jpg",
  snes: "Nintendo-Super-NES-Controller.jpg",
  n64: "N64-Controller-Gray.jpg",
  gb: "Game-Boy-FL.png",
  gbc: "Nintendo-Game-Boy-Color-FL.png",
  gba: "Nintendo-Game-Boy-Advance-Purple-FL.jpg",
  nds: "Nintendo-DS-Lite-Black-Open.png",
  vb: "Virtual-Boy-Controller.jpg",
  sms: "Sega-Master-System-Controllers.jpg",
  genesis: "Sega-Genesis-3But-Cont.jpg",
  gamegear: "Sega-Game-Gear-WB.png",
  sg1000: "Sega-SG-1000-Console-Set.png",
  "32x": "Sega-Genesis-6But-Cont.jpg",
  saturn: "Sega-Saturn-Controller-NA-Mk-II-FL.jpg",
  segacd: "Sega-CD-Model2-Set.png",
  psx: "PSX-Original-Controller.png",
  psp: "PSP-1000.png",
  atari2600: "Atari-2600-Joystick.jpg",
  atari5200: "Atari-5200-Controller.jpg",
  atari7800: "Atari-CX78-7800-Controller-FL.jpg",
  jaguar: "Atari-Jaguar-Controller.jpg",
  lynx: "Atari-Lynx-I-Handheld.png",
  pce: "NEC-TurboGrafx-16-Controller-FR.jpg",
  pcecd: "NEC-TurboDuo-Controller-L.jpg",
  ngp: "Neo-Geo-Pocket-Color-Blue-Left.jpg",
  wonderswan: "WonderSwan-Color-Blue-Left.png",
  coleco: "ColecoVision-Controller-FL.jpg",
  "3do": "3DO-101M-Controller.jpg",
  arcade: "Neo-Geo-AES-Controller-FL.jpg",
  c64: "Commodore-64-Computer-FL.png",
  c128: "Commodore-128.png",
  vic20: "Commodore-VIC-20-FL.jpg",
  pet: "Commodore 2001 Series-IMG 0448b.png",
  plus4: "Commodore Plus 4.jpg",
  amiga: "Amiga500 system.jpg",
  dos: "IBM PC-IMG 7271.jpg",
  doom: "IBM PC-IMG 7271.jpg",
  zxspectrum: "ZXSpectrum48k.jpg",
  zx81: "Sinclair-ZX81.png",
  cpc: "Amstrad CPC464.jpg",
  // Desktop-app consoles
  gamecube: "Gamecube-controller.jpg",
  wii: "Wii-Console.png",
  wiiu: "Wii U Gamepad schwarz transparent.png",
  switch: "Nintendo-Switch-JoyCon-Grip-FL.jpg",
  "3ds": "Nintendo-3DS-AquaOpen.png",
  dreamcast: "Sega-Dreamcast-Controller-wVMU-FL.png",
  ps2: "PlayStation2-DualShock2.png",
  ps3: "PlayStation3-DualShock3.png",
  ps4: "DualShock_4.jpg",
  vita: "PlayStation-Vita-1101-FL.png",
  xbox: "Xbox-Controller-Duke-FL.jpg",
  xbox360: "Xbox-360-Controller-Black.png",
  vectrex: "GCE-Vectrex-Controller-FL.jpg",
  intellivision: "Intellivision-Controller.jpg",
  neogeocd: "Neo-Geo-CD-Controller-FL.jpg",
  atari800: "Atari-800XL.jpg",
  cd32: "Amiga-CD32-Controller-L.jpg",
};

// Names for consoles whose photo exists before the console itself is in server/systems.js.
const NAMES = {
  gamecube: "Nintendo GameCube", wii: "Nintendo Wii", wiiu: "Nintendo Wii U", switch: "Nintendo Switch", "3ds": "Nintendo 3DS",
  dreamcast: "Sega Dreamcast", ps2: "PlayStation 2", ps3: "PlayStation 3", ps4: "PlayStation 4", vita: "PlayStation Vita",
  xbox: "Xbox", xbox360: "Xbox 360", vectrex: "Vectrex", intellivision: "Intellivision", neogeocd: "Neo Geo CD",
  atari800: "Atari 800", cd32: "Amiga CD32",
};
export const photoName = (id) => BY_ID[id]?.name || NAMES[id] || id;

const FREE = /^(public domain|pd\b|cc0|cc[ -]by(-sa)?[ -]\d)/i;
const strip = (s = "") => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

async function commonsInfo(files) {
  const out = {};
  for (let i = 0; i < files.length; i += 40) {
    const titles = files.slice(i, i + 40).map((f) => `File:${f}`).join("|");
    const u = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", titles, prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "1600" })}`;
    let j;
    for (let tries = 0; ; tries++) {
      const res = await fetch(u, { headers: { "user-agent": UA } });
      const text = await res.text();
      if (res.ok && text.startsWith("{")) { j = JSON.parse(text); break; }
      if (tries > 4) throw new Error(`Commons API: HTTP ${res.status} ${text.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 15000 * (tries + 1)));
    }
    const norm = Object.fromEntries((j.query.normalized || []).map((n) => [n.to, n.from]));
    for (const p of Object.values(j.query.pages)) {
      const name = (norm[p.title] || p.title).replace(/^File:/, "");
      const ii = p.imageinfo?.[0];
      if (!ii) { out[name] = null; continue; }
      const m = ii.extmetadata || {};
      out[name] = {
        url: ii.thumburl || ii.url, page: ii.descriptionurl, mime: ii.mime,
        license: strip(m.LicenseShortName?.value), licenseUrl: m.LicenseUrl?.value || "",
        artist: strip(m.Artist?.value) || "Unknown",
      };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return out;
}

// Cut a studio photo out of its white background: flood-fill near-white pixels inward from the
// edges, give the boundary a soft alpha ramp, and remove the white fringe from semi-transparent
// pixels. Photos that already have transparency are only trimmed.
async function cutout(buf) {
  const img = sharp(buf).rotate();
  const meta = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, px = data;
  let hasAlpha = false;
  if (meta.hasAlpha) for (let i = 3; i < px.length; i += 4 * 97) if (px[i] < 250) { hasAlpha = true; break; }
  if (!hasAlpha) {
    const T0 = 10, T1 = 46; // distance from white: <T0 fully clear, >T1 fully solid
    const dist = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const r = px[p], g = px[p + 1], b = px[p + 2];
      dist[i] = Math.min(255, Math.max(255 - r, 255 - g, 255 - b) + (Math.max(r, g, b) - Math.min(r, g, b)));
    }
    const bg = new Uint8Array(W * H);
    const stack = [];
    const push = (i) => { if (!bg[i] && dist[i] < T1) { bg[i] = 1; stack.push(i); } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (stack.length) {
      const i = stack.pop(), x = i % W;
      if (x > 0) push(i - 1);
      if (x < W - 1) push(i + 1);
      if (i >= W) push(i - W);
      if (i < W * (H - 1)) push(i + W);
    }
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      if (!bg[i]) continue;
      const a = Math.max(0, Math.min(1, (dist[i] - T0) / (T1 - T0)));
      px[p + 3] = Math.round(a * 255);
      if (a > 0) for (let c = 0; c < 3; c++) px[p + c] = Math.max(0, Math.min(255, Math.round((px[p + c] - (1 - a) * 255) / a)));
    }
  }
  return sharp(px, { raw: { width: W, height: H, channels: 4 } })
    .trim({ threshold: 1, lineArt: false })
    .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 90, effort: 6 })
    .toBuffer();
}

async function main() {
  const want = process.argv.slice(2);
  const ids = want.length ? want : Object.keys(PHOTOS);
  const files = [...new Set(ids.map((id) => PHOTOS[id]).filter(Boolean))];
  fs.mkdirSync(OUT, { recursive: true });
  const info = await commonsInfo(files);
  const creditsFile = path.join(OUT, "credits.json");
  const credits = fs.existsSync(creditsFile) ? JSON.parse(fs.readFileSync(creditsFile, "utf8")) : {};
  let failed = 0;
  for (const id of ids) {
    const file = PHOTOS[id];
    const meta = info[file];
    if (!meta) { console.error(`✗ ${id}: ${file} not found on Commons`); failed++; continue; }
    if (!FREE.test(meta.license)) { console.error(`✗ ${id}: ${file} has license "${meta.license}", not free enough`); failed++; continue; }
    let buf;
    for (let tries = 0; ; tries++) {
      const res = await fetch(meta.url, { headers: { "user-agent": UA } });
      if (res.ok) { buf = Buffer.from(await res.arrayBuffer()); break; }
      if (tries > 4) throw new Error(`${file}: HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, 10000 * (tries + 1)));
    }
    const webp = await cutout(buf);
    fs.writeFileSync(path.join(OUT, `${id}.webp`), webp);
    credits[id] = { name: photoName(id), file, page: meta.page, artist: meta.artist, license: meta.license, licenseUrl: meta.licenseUrl };
    console.log(`✓ ${id.padEnd(12)} ${(webp.length / 1024).toFixed(0).padStart(4)} KB  ${meta.license}  ${meta.artist}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  const sorted = Object.fromEntries(Object.entries(credits).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(creditsFile, JSON.stringify(sorted, null, 2) + "\n");
  const md = ["# Controller photos", "", "Photos from Wikimedia Commons, cut out of their backgrounds and resized for Phosphor.",
    "Modified versions of CC BY-SA photos are shared under the same license.", "",
    "| Console | Photo | By | License |", "|---|---|---|---|",
    ...Object.entries(sorted).map(([id, c]) => `| ${c.name || id} | [${c.file}](${c.page}) | ${c.artist} | ${c.licenseUrl ? `[${c.license}](${c.licenseUrl})` : c.license} |`), ""];
  fs.writeFileSync(path.join(OUT, "CREDITS.md"), md.join("\n"));
  if (failed) { console.error(`${failed} photo(s) failed`); process.exit(1); }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
