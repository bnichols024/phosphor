// Builds db/<system>.json.gz from the libretro database (No-Intro, Redump, FBNeo DATs plus the
// genre/year/developer/publisher/players metadata). The app uses these to put real names, years and
// genres on ROMs by checksum or filename, and to find their box art.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { SYSTEMS } from "../server/systems.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "db");
const BASE = "https://raw.githubusercontent.com/libretro/libretro-database/master/";
const META = { genre: "genre", releaseyear: "year", developer: "developer", publisher: "publisher", maxusers: "players" };

async function get(rel) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(BASE + rel.split("/").map(encodeURIComponent).join("/"));
    if (res.status === 404) return null;
    if (res.ok) return res.text();
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`failed to fetch ${rel}`);
}

// clrmamepro DAT -> [{ key: value | [values], rom: [{...}] }]
export function parseDat(text) {
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|\(|\)|[^\s()"]+/g) || [];
  let i = 0;
  const unq = (t) => (t[0] === '"' ? t.slice(1, -1) : t);
  function block() {
    const obj = {};
    while (i < tokens.length && tokens[i] !== ")") {
      const key = tokens[i++];
      let val;
      if (tokens[i] === "(") { i++; val = block(); i++; } else val = unq(tokens[i++] ?? "");
      if (key in obj) { if (!Array.isArray(obj[key]) || key !== "rom") obj[key] = [].concat(obj[key], val); else obj[key].push(val); }
      else obj[key] = key === "rom" ? [val] : val;
    }
    return obj;
  }
  const games = [];
  while (i < tokens.length) {
    const key = tokens[i++];
    if (tokens[i] !== "(") continue;
    i++;
    const b = block();
    i++;
    if (key === "game" || key === "machine") games.push(b);
  }
  return games;
}

const stripExt = (n) => n.replace(/\.[a-z0-9]{1,4}$/i, "");

async function buildSystem(sys) {
  const games = [];
  const byName = new Map();
  const crc = {};
  const files = {};
  const serials = {};
  for (const rel of sys.dats) {
    const text = await get(rel);
    if (!text) { console.warn(`  missing ${rel}`); continue; }
    for (const g of parseDat(text)) {
      const name = g.name || g.comment;
      if (!name) continue;
      let idx = byName.get(name);
      if (idx === undefined) {
        idx = games.length;
        byName.set(name, idx);
        const row = [name, null, null, null, null, null];
        if (sys.arcade) { row[1] = g.releaseyear ? Number(g.releaseyear) || null : null; row[5] = g.publisher || null; }
        games.push(row);
      }
      for (const s of [].concat(g.serial || [], ...(g.rom || []).map((r) => r.serial || []))) {
        for (const one of String(s).split(/[,/]\s*/)) {
          const k = one.toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (k.length >= 6 && !(k in serials)) serials[k] = idx;
        }
      }
      for (const r of g.rom || []) {
        if (r.crc && !(r.crc.toUpperCase() in crc)) crc[r.crc.toUpperCase()] = idx;
        if (r.name) {
          const base = stripExt(path.basename(r.name.replace(/\\/g, "/"))).toLowerCase();
          if (!(base in files)) files[base] = idx;
        }
      }
      const gl = name.toLowerCase();
      if (!(gl in files)) files[gl] = idx;
    }
  }
  if (sys.meta && !sys.arcade) {
    for (const [dir, field] of Object.entries(META)) {
      const text = await get(`metadat/${dir}/${sys.meta}.dat`);
      if (!text) continue;
      const col = { year: 1, genre: 2, players: 3, developer: 4, publisher: 5 }[field];
      for (const g of parseDat(text)) {
        const v = g.genre ?? g.releaseyear ?? g.developer ?? g.publisher ?? g.users;
        if (v === undefined) continue;
        let idx = g.comment !== undefined ? byName.get(g.comment) : undefined;
        if (idx === undefined) for (const r of g.rom || []) if (r.crc && crc[r.crc.toUpperCase()] !== undefined) { idx = crc[r.crc.toUpperCase()]; break; }
        if (idx === undefined) continue;
        games[idx][col] = field === "year" || field === "players" ? Number(v) || null : String(v);
      }
    }
  }
  // Region variants and revisions of one game share metadata: fill gaps from siblings.
  const base = (n) => n.replace(/\s*[([].*$/, "").toLowerCase();
  const groups = new Map();
  games.forEach((g, i) => { const b = base(g[0]); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(i); });
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    for (let col = 1; col <= 5; col++) {
      const donor = idxs.map((i) => games[i][col]).find((v) => v !== null && v !== undefined);
      if (donor === undefined) continue;
      for (const i of idxs) if (games[i][col] === null || games[i][col] === undefined) games[i][col] = donor;
    }
  }
  return { system: sys.id, built: new Date().toISOString(), games, crc, files, serials };
}

fs.mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(3);
for (const sys of SYSTEMS) {
  if (only.length && !only.includes(sys.id)) continue;
  if (!sys.dats.length) continue;
  process.stdout.write(`${sys.id}… `);
  const db = await buildSystem(sys);
  const gz = zlib.gzipSync(JSON.stringify(db), { level: 9 });
  fs.writeFileSync(path.join(outDir, `${sys.id}.json.gz`), gz);
  console.log(`${db.games.length} games, ${Object.keys(db.crc).length} checksums, ${(gz.length / 1024).toFixed(0)} KB`);
}
