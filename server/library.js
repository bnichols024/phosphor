// The library: creates the folder layout, scans ROM folders, auto-sorts anything dropped into the
// drop folder (games, BIOS files, whole collections), groups multi-disc games, and keeps the
// database in step with the disk.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { SYSTEMS, BY_ID, systemForFolder, EXT_INDEX, AMBIGUOUS_EXTS } from "./systems.js";
import { identify, referencedFiles } from "./identify.js";
import { parseName, sortTitle } from "./gamedb.js";
import { readSfo, detectSystemFiles, SYSTEM_FILE_NAMES, SYSTEM_FILE_LABELS } from "./native/files.js";
import { extract } from "./native/manager.js";
import { listZip } from "./lib/zip.js";

// The file a folder game starts from: PS3/PS4/Vita EBOOT.BIN, a Wii U .rpx, Switch exefs/main.
const FOLDER_GAME_FILE = /(^|[\\/])eboot\.bin$|\.rpx$|[\\/]exefs[\\/]main$|^exefs[\\/]main$/i;

export const DROP_FOLDER = "Drop Games Here";
// Bump when identification improves: the next startup re-checks every file once.
export const IDENTIFY_VERSION = 6;
const SKIP_EXTS = new Set(["txt", "nfo", "jpg", "jpeg", "png", "gif", "webp", "pdf", "srm", "sav", "state", "dat", "xml", "db", "ini", "cfg", "md", "url", "html", "htm", "sfv", "md5", "sha1", "ds_store", "lnk", "sub", "ecm", "wav", "ogg", "mp3", "flac", "aiff"]);
const KNOWN_EXTS = new Set([...Object.keys(EXT_INDEX), ...AMBIGUOUS_EXTS, ...SYSTEMS.flatMap((s) => s.discExts || []), "tap", "sna", "dsk"]);

const README = `PHOSPHOR GAME LIBRARY
=====================

The easy way: drop games (or whole folders of them, zipped or not) into
"${DROP_FOLDER}". Phosphor works out which console each one is for, moves it
into the right folder below, and adds box art. You can also drag files onto
the Phosphor window in your browser.

The manual way: put games straight into the matching folder in ROMs/.
Subfolders are fine. Folder names from RetroArch, Batocera, ES-DE and
RetroPie (nes, snes, psx, megadrive...) are recognised too.

Disc games (PlayStation, Saturn, Sega CD, PC Engine CD): use .chd, or .cue
with its .bin files next to it. Multi-disc games are grouped automatically.

Arcade: one FinalBurn Neo .zip per game, file names unchanged (sf2.zip).
DOS: one .zip per game.

BIOS/      You don't need anything here: every console Phosphor shows has its
           BIOS included (a free BIOS that ships with Phosphor, or one built
           into its emulator). Official BIOS files you own can go here, or
           anywhere else; Phosphor recognises them by checksum and uses them.
           Consoles that can't run without a copyrighted BIOS (Sega CD,
           TurboGrafx-CD, 3DO, ColecoVision, Lynx) only appear once you add
           yours. Neo Geo arcade games also need neogeo.zip.
Saves/     Your in-game saves, one folder per player, as standard .srm files
           (they work in RetroArch too). Back this folder up.
Screenshots/
.phosphor/ Phosphor's own data (database, box art cache, save states).
`;

export class Library extends EventEmitter {
  constructor({ root, db, gamedb, log = console }) {
    super();
    this.root = root;
    this.romsDir = path.join(root, "ROMs");
    this.dropDir = path.join(root, DROP_FOLDER);
    this.biosDir = path.join(root, "BIOS");
    this.savesDir = path.join(root, "Saves");
    this.shotsDir = path.join(root, "Screenshots");
    this.db = db;
    this.gamedb = gamedb;
    this.log = log;
    this.scanning = null;
    this.status = { phase: "idle", done: 0, total: 0, current: "", lastScan: null, added: 0, unknown: [] };
    this._rescanQueued = false;
    this._md5Cache = new Map();
  }

  async ensureLayout() {
    for (const d of [this.romsDir, this.dropDir, this.biosDir, this.savesDir, this.shotsDir]) await fsp.mkdir(d, { recursive: true });
    // Consoles that can't run without a copyrighted BIOS don't get a folder (or appear anywhere)
    // until the user adds that BIOS.
    const locked = await this.lockedSystems();
    for (const s of SYSTEMS) {
      const dir = path.join(this.romsDir, s.folder);
      if (!locked.has(s.id)) await fsp.mkdir(dir, { recursive: true });
      else await fsp.rmdir(dir).catch(() => {}); // only ever removes an empty folder
    }
    const readme = path.join(this.root, "README.txt");
    if (!fs.existsSync(readme)) await fsp.writeFile(readme, README);
  }

  _emit(patch) { Object.assign(this.status, patch); this.emit("progress", { ...this.status }); }

  // ---- BIOS ----
  async biosStatus() {
    const have = {};
    const listing = [];
    const files = await walk(this.biosDir).catch(() => []);
    for (const f of files) {
      const st = await fsp.stat(f).catch(() => null);
      if (!st) continue;
      listing.push({ file: f, name: path.basename(f).toLowerCase(), size: st.size });
      if (st.size > 16 * 1024 * 1024) continue; // firmware files: recognised by name, no checksum
      const key = `${f}|${st.size}|${st.mtimeMs}`;
      if (!this._md5Cache.has(key)) this._md5Cache.set(key, await md5File(f));
      have[path.basename(f).toLowerCase()] = { file: f, md5: this._md5Cache.get(key) };
    }
    // Desktop consoles' own files (PS2 BIOS, Switch keys, Xbox BIOS, Sony firmware).
    const known = new Set(Object.keys(this._biosByName()));
    const sysFiles = await detectSystemFiles(listing, { exclude: known });
    const out = {};
    for (const s of SYSTEMS) {
      if (!s.bios) continue;
      const found = s.bios.files.map((b) => {
        const byName = have[b.name.toLowerCase()];
        const byHash = Object.values(have).find((h) => h.md5 === b.md5);
        const hit = byName || byHash;
        return { name: b.name, label: b.label, found: !!hit, verified: !!hit && hit.md5 === b.md5, file: hit?.file || null };
      });
      out[s.id] = { required: !!s.bios.required, ready: !s.bios.required || found.some((f) => f.found), yours: found.some((f) => f.found), files: found,
        included: s.includedBios?.[0]?.label || s.builtinBios || null };
    }
    for (const s of SYSTEMS) {
      const det = sysFiles[s.needs?.files || s.id];
      if (!det) continue;
      const optional = new Set(det.optional || []);
      out[s.id] = { required: !!s.needs, ready: det.ready, yours: Object.values(det.files).some(Boolean), paths: det.files,
        files: Object.entries(det.files).map(([k, v]) => ({ name: v ? path.basename(v) : k, label: SYSTEM_FILE_LABELS[k] || k, found: !!v, verified: !!v, file: v, optional: optional.has(k) })),
        // What still has to be added, by name, for the lock message.
        missing: det.ready ? [] : Object.entries(det.files).filter(([k, v]) => !v && !optional.has(k)).map(([k]) => SYSTEM_FILE_LABELS[k] || k),
        needs: s.needs || null };
    }
    out.arcade = { ready: true, neogeo: !!have["neogeo.zip"], files: [{ name: "neogeo.zip", label: "Neo Geo BIOS (only for Neo Geo games)", found: !!have["neogeo.zip"], verified: !!have["neogeo.zip"] }] };
    return out;
  }

  _biosByName() {
    const m = { "neogeo.zip": { name: "neogeo.zip", md5: null } };
    for (const s of SYSTEMS) for (const b of s.bios?.files || []) m[b.name.toLowerCase()] = { name: b.name, md5: b.md5 };
    return m;
  }

  // Systems that need the user's own BIOS and don't have it yet: hidden everywhere.
  async lockedSystems() {
    const st = await this.biosStatus();
    return new Set(SYSTEMS.filter((s) => s.bios?.required && !st[s.id]?.ready).map((s) => s.id));
  }

  // Known BIOS md5 -> canonical file name, for sorting dropped BIOS files.
  _biosByMd5() {
    const m = {};
    for (const s of SYSTEMS) for (const b of s.bios?.files || []) m[b.md5] = b.name;
    return m;
  }

  // ---- scanning ----
  scan({ reason = "manual", full = false } = {}) {
    if (this.scanning) { this._rescanQueued = true; this._fullQueued ||= full; return this.scanning; }
    this.scanning = this._scan(reason, full).finally(() => {
      this.scanning = null;
      if (this._rescanQueued) { const full2 = this._fullQueued; this._rescanQueued = false; this._fullQueued = false; this.scan({ reason: "queued", full: full2 }); }
    });
    return this.scanning;
  }

  // Scan, then wait until no scan is running (including any queued while this one ran).
  async settle({ reason = "manual" } = {}) {
    this.scan({ reason });
    while (this.scanning) await this.scanning.catch(() => {});
  }

  addedSince(ms) {
    return this.db.get("SELECT COUNT(*) n FROM games WHERE added_at >= ? AND missing_since IS NULL", ms).n;
  }

  async _scan(reason, full = false) {
    const t0 = Date.now();
    this._emit({ phase: "sorting", done: 0, total: 0, current: "", added: 0 });
    const sorted = await this.sortDrop();
    await this.ensureLayout(); // a BIOS that just arrived unlocks its console's folder
    this._emit({ phase: "scanning", current: "" });

    // Collect candidate files per system folder (including alias folders like "snes" or "psx").
    // BIOS files kept next to games (common in RetroPie/Batocera setups) move to BIOS/ instead.
    const candidates = [];
    const biosNames = this._biosByName();
    for (const entry of await fsp.readdir(this.romsDir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const sys = systemForFolder(entry.name);
      if (!sys) continue;
      const dir = path.join(this.romsDir, entry.name);
      const files = [];
      for (const f of await walk(dir)) {
        const known = biosNames[path.basename(f).toLowerCase()];
        if (known && (known.md5 === null || (await fsp.stat(f)).size <= 4 * 1024 * 1024 && (await md5File(f)) === known.md5)) {
          await moveInto(f, this.biosDir, known.name).catch(() => {});
          continue;
        }
        files.push(f);
      }
      for (const group of await groupGames(files)) candidates.push({ ...group, folderSystem: sys });
    }

    const existing = new Map(this.db.all("SELECT id, path, size, mtime, crc, system, missing_since FROM games").map((r) => [r.path, r]));
    // Mark vanished files first, so a renamed or moved file found below can take over its history.
    const present = new Set(candidates.map((c) => path.relative(this.root, c.main)));
    const now = Date.now();
    for (const [p, row] of existing) {
      if (!present.has(p) && !row.missing_since) this.db.run("UPDATE games SET missing_since = ? WHERE id = ?", now, row.id);
    }
    const seen = new Set();
    let added = 0;
    this._emit({ total: candidates.length, done: 0 });
    let done = 0;
    for (const c of candidates) {
      const rel = path.relative(this.root, c.main);
      seen.add(rel);
      const st = await fsp.stat(c.main).catch(() => null);
      if (!st) continue;
      const prev = existing.get(rel);
      const size = c.files.length > 1 ? await totalSize(c.files) : st.size;
      if (!full && prev && prev.size === size && prev.mtime === Math.floor(st.mtimeMs) && !prev.missing_since) { done++; continue; }
      this._emit({ current: path.basename(c.main), done });
      try {
        const id = await identify(c.main, { folderSystem: c.folderSystem, gamedb: this.gamedb, arcadeHint: c.folderSystem === "arcade", folderGame: c.folder });
        if (id) {
          const isNew = this._upsert(rel, c, id, size, prev);
          if (isNew) added++;
        }
      } catch (e) {
        this.log.warn?.(`scan: ${rel}: ${e.message}`);
      }
      done++;
      if (done % 25 === 0) this._emit({ done });
    }

    // Files that vanished stay hidden (missing_since) with their play history, in case they come back.
    const lastScan = { at: new Date().toISOString(), ms: Date.now() - t0, reason, added, sorted: sorted.moved, total: this.db.get("SELECT COUNT(*) n FROM games WHERE missing_since IS NULL").n };
    this._emit({ phase: "idle", done: candidates.length, current: "", lastScan, added });
    this.emit("changed", lastScan);
    this.log.info?.(`scan (${reason}): ${lastScan.total} games, +${added}, sorted ${sorted.moved}, ${lastScan.ms} ms`);
    return lastScan;
  }

  _upsert(rel, group, id, size, prev) {
    const name = id.match?.name || id.title || path.basename(group.main, path.extname(group.main));
    const p = parseName(name);
    const fileP = parseName(path.basename(group.main));
    const title = p.title;
    const files = JSON.stringify(group.files.map((f) => path.relative(this.root, f)));
    const st = fs.statSync(group.main);
    const row = {
      system: id.system, path: rel, files, size, mtime: Math.floor(st.mtimeMs), crc: id.crc, serial: id.serial,
      title, sort_title: sortTitle(title), db_name: id.match?.name || null, region: p.region || fileP.region,
      tags: JSON.stringify(p.tags), year: id.match?.year || null, genre: id.match?.genre || null,
      players: id.match?.players || null, developer: id.match?.developer || null, publisher: id.match?.publisher || null,
      discs: group.discs || 1, matched: id.match ? 1 : 0,
    };
    if (!prev) {
      // A file that moved or was renamed keeps its history: re-link by checksum or name.
      const relink = (row.crc && this.db.get("SELECT id FROM games WHERE missing_since IS NOT NULL AND crc = ? AND system = ?", row.crc, row.system))
        || this.db.get("SELECT id FROM games WHERE missing_since IS NOT NULL AND system = ? AND title = ? AND IFNULL(region,'') = IFNULL(?, '')", row.system, row.title, row.region);
      if (relink) prev = { id: relink.id };
    }
    if (prev) {
      const old = this.db.get("SELECT db_name, art_checked FROM games WHERE id = ?", prev.id);
      const resetArt = old && old.db_name !== row.db_name ? ", art_checked = 0, art_box = NULL, art_snap = NULL, art_title = NULL" : "";
      this.db.run(`UPDATE games SET system=?, path=?, files=?, size=?, mtime=?, crc=?, serial=?, title=?, sort_title=?, db_name=?, region=?, tags=?, year=?, genre=?, players=?, developer=?, publisher=?, discs=?, matched=?, missing_since=NULL${resetArt} WHERE id=?`,
        row.system, row.path, row.files, row.size, row.mtime, row.crc, row.serial, row.title, row.sort_title, row.db_name, row.region, row.tags, row.year, row.genre, row.players, row.developer, row.publisher, row.discs, row.matched, prev.id);
      this.emit("game", { id: prev.id, isNew: false });
      return false;
    }
    const r = this.db.run(`INSERT INTO games(system, path, files, size, mtime, crc, serial, title, sort_title, db_name, region, tags, year, genre, players, developer, publisher, discs, matched, added_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      row.system, row.path, row.files, row.size, row.mtime, row.crc, row.serial, row.title, row.sort_title, row.db_name, row.region, row.tags, row.year, row.genre, row.players, row.developer, row.publisher, row.discs, row.matched, Date.now());
    this.emit("game", { id: Number(r.lastInsertRowid), isNew: true });
    return true;
  }

  // ---- drop folder ----
  // Moves every recognisable game (with its companion files) and BIOS file out of the drop folder
  // into place. Leaves anything unrecognised where it is and reports it.
  async sortDrop() {
    if (await this._unpackFolderZips()) this.log.info?.("drop: unpacked zipped game folders");
    const all = await walk(this.dropDir).catch(() => []);
    if (!all.length) { this.status.unknown = []; return { moved: 0, unknown: [] }; }
    const biosMd5 = this._biosByMd5();
    let moved = 0;
    const unknown = [];
    const handled = new Set();

    // BIOS files first (small files whose md5 matches a known BIOS, or neogeo.zip).
    for (const f of all) {
      const st = await fsp.stat(f).catch(() => null);
      if (!st) continue;
      if (path.basename(f).toLowerCase() === "neogeo.zip" || (st.size <= 4 * 1024 * 1024 && biosMd5[await md5File(f)])) {
        const name = path.basename(f).toLowerCase() === "neogeo.zip" ? "neogeo.zip" : biosMd5[await md5File(f)];
        await moveInto(f, this.biosDir, name);
        handled.add(f);
        moved++;
      }
    }

    // Desktop consoles' files: keys and firmware by name, a PS2 BIOS by its contents, Xbox BIOS by
    // its usual names and sizes.
    for (const f of all) {
      if (handled.has(f)) continue;
      const name = path.basename(f).toLowerCase();
      const st = await fsp.stat(f).catch(() => null);
      if (!st) continue;
      let to = SYSTEM_FILE_NAMES.test(name) ? path.basename(f) : null;
      if (!to && (st.size === 262144 || st.size === 1048576) && /\.bin$/.test(name) && /xbox|complex|4627|5838|5933|evox|m8plus|ind-bios|bios/.test(name) && !this._biosByName()[name]) to = path.basename(f);
      if (!to && st.size >= 4 * 1024 * 1024 && st.size <= 16 * 1024 * 1024 && /\.bin$/.test(name)) {
        const det = await detectSystemFiles([{ file: f, name, size: st.size }]);
        if (det.ps2.ready) to = path.basename(f);
      }
      if (to) { await moveInto(f, this.biosDir, to); handled.add(f); moved++; }
    }

    // Patches (.ips/.bps/.ups) go next to the game with the same name, wherever it lives.
    for (const f of all) {
      if (handled.has(f) || ![".ips", ".bps", ".ups"].includes(path.extname(f).toLowerCase())) continue;
      const stem = path.basename(f, path.extname(f)).toLowerCase();
      const pending = all.find((x) => x !== f && !handled.has(x) && path.basename(x, path.extname(x)).toLowerCase() === stem && ![".ips", ".bps", ".ups"].includes(path.extname(x).toLowerCase()));
      if (pending) continue; // the game itself is in this drop; the patch moves with it below
      const row = this.db.all("SELECT path FROM games WHERE missing_since IS NULL").find((r) => path.basename(r.path, path.extname(r.path)).toLowerCase() === stem);
      if (row) {
        const romAbs = this.absPath(row.path);
        await moveFile(f, romAbs.slice(0, romAbs.length - path.extname(romAbs).length) + path.extname(f).toLowerCase());
        handled.add(f);
        moved++;
      }
    }

    for (const group of await groupGames(all.filter((f) => !handled.has(f)))) {
      if (group.files.some((f) => handled.has(f))) continue;
      group.files.forEach((f) => handled.add(f));
      let id = null;
      try { id = await identify(group.main, { gamedb: this.gamedb, arcadeHint: true, folderGame: group.folder }); } catch { id = null; }
      if (!id) { unknown.push(path.relative(this.dropDir, group.main)); continue; }
      const dest = path.join(this.romsDir, BY_ID[id.system].folder);
      const stemOf = (x) => x.slice(0, x.length - path.extname(x).length);
      const patch = all.find((x) => [".ips", ".bps", ".ups"].includes(path.extname(x).toLowerCase()) && stemOf(x).toLowerCase() === stemOf(group.main).toLowerCase());
      const destMain = await moveGroup(group, dest);
      if (destMain && patch && fs.existsSync(patch)) { await moveFile(patch, stemOf(destMain) + path.extname(patch).toLowerCase()); handled.add(patch); }
      if (destMain) moved++;
      else unknown.push(path.relative(this.dropDir, group.main));
    }
    // Ignored leftovers (readme, images) don't count as unknown; report real candidates only.
    await removeEmptyDirs(this.dropDir);
    this.status.unknown = unknown;
    if (moved) this.log.info?.(`drop: sorted ${moved} item(s)${unknown.length ? `, ${unknown.length} not recognised` : ""}`);
    return { moved, unknown };
  }

  // Desktop consoles run games from unpacked folders (Switch/Switch 2 exefs, PS3/PS4/Vita EBOOT.BIN,
  // Wii U .rpx) and can't read them from inside a zip, so a zip holding one is unpacked here and the
  // zip removed. Unpacking goes into a hidden folder first, so a scan never sees half a game.
  async _unpackFolderZips() {
    let unpacked = 0;
    for (const f of await walk(this.dropDir).catch(() => [])) {
      if (path.extname(f).toLowerCase() !== ".zip") continue;
      const entries = await listZip(f);
      if (!entries?.some((e) => FOLDER_GAME_FILE.test(e.name.replace(/\\/g, "/")))) continue;
      const tmp = path.join(path.dirname(f), `.unpack-${crypto.randomBytes(4).toString("hex")}`);
      this._emit({ phase: "sorting", current: `Unpacking ${path.basename(f)}…` });
      try {
        await fsp.mkdir(tmp, { recursive: true });
        await extract(f, tmp);
        const top = (await fsp.readdir(tmp)).filter((n) => !n.startsWith(".") && n !== "__MACOSX");
        // Game files right at the top of the zip: the zip's name becomes the folder's name.
        if (top.some((n) => /^(exefs|romfs|usrdir|code|content|meta|sce_sys)$/i.test(n) || /^eboot\.bin$/i.test(n))) {
          await fsp.rename(tmp, await uniqueTarget(path.dirname(f), path.basename(f, path.extname(f))));
        } else {
          for (const n of top) await fsp.rename(path.join(tmp, n), await uniqueTarget(path.dirname(f), n));
          await fsp.rm(tmp, { recursive: true, force: true });
        }
        await fsp.rm(f, { force: true });
        unpacked++;
      } catch (e) {
        this.log.warn?.(`drop: couldn't unpack ${path.basename(f)}: ${e.message}`);
        await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      }
    }
    return unpacked;
  }

  // ---- watching ----
  watch() {
    const trigger = debounce(() => this.scan({ reason: "files changed" }), 2500);
    for (const dir of [this.romsDir, this.dropDir, this.biosDir]) {
      try {
        fs.watch(dir, { recursive: true }, (_ev, file) => {
          if (file && /(^|[\\/])\./.test(file)) return;
          trigger();
        });
      } catch (e) {
        this.log.warn?.(`watch ${dir}: ${e.message}`);
      }
    }
    // Network shares don't always deliver change events, so also look every few minutes.
    setInterval(() => this.scan({ reason: "periodic" }), 5 * 60 * 1000).unref();
  }

  absPath(rel) {
    const abs = path.resolve(this.root, rel);
    if (!abs.startsWith(path.resolve(this.root) + path.sep)) throw new Error("path outside library");
    return abs;
  }
}

// ---- helpers ----

export async function walk(dir, out = []) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name.startsWith("._")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const extOf = (f) => path.extname(f).slice(1).toLowerCase();

// Turns a flat file list into games: cue/m3u/ccd + the files they reference become one game, and
// "(Disc 1)", "(Disc 2)"... of the same title in the same folder become one multi-disc game.
export async function groupGames(files) {
  // Folder games (PS3, PS4, Vita, Wii U): the whole folder is one game, started from its main file.
  const folders = new Map();
  for (const f of files) {
    if (!FOLDER_GAME_FILE.test(f)) continue;
    const g = await folderGame(f).catch(() => null);
    if (g && !folders.has(g.root)) folders.set(g.root, g);
  }
  if (folders.size) {
    const roots = [...folders.keys()].map((r) => r + path.sep);
    files = files.filter((f) => !roots.some((r) => f.startsWith(r)));
  }
  const companions = new Set();
  const sheets = files.filter((f) => ["cue", "m3u", "ccd", "gdi"].includes(extOf(f)));
  const refs = new Map();
  for (const s of sheets) {
    const r = (await referencedFiles(s)).filter((f) => fs.existsSync(f));
    refs.set(s, r);
    r.forEach((f) => companions.add(f));
  }
  const mains = files.filter((f) => {
    if (companions.has(f)) return false;
    const ext = extOf(f);
    if (SKIP_EXTS.has(ext) || !ext) return false;
    return KNOWN_EXTS.has(ext);
  });
  // Multi-disc grouping for discs not already covered by an m3u.
  const groups = [];
  const byKey = new Map();
  for (const m of mains) {
    const base = path.basename(m);
    const disc = base.match(/\((?:Disc|Disk|CD)\s*(\d+)(?:\s*of\s*\d+)?\)/i);
    if (disc && ["cue", "chd", "pbp", "iso", "ccd", "cso"].includes(extOf(m))) {
      const key = path.join(path.dirname(m), base.replace(disc[0], "").replace(/\s+/g, " ").toLowerCase());
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ file: m, n: Number(disc[1]) });
      continue;
    }
    groups.push({ main: m, files: [m, ...(refs.get(m) || [])], discs: 1 });
  }
  for (const discs of byKey.values()) {
    discs.sort((a, b) => a.n - b.n);
    const filesAll = discs.flatMap((d) => [d.file, ...(refs.get(d.file) || [])]);
    groups.push({ main: discs[0].file, files: filesAll, discs: discs.length, discFiles: discs.map((d) => d.file) });
  }
  for (const g of folders.values()) groups.push({ main: g.main, files: [g.main], discs: 1, folder: g });
  return groups;
}

// Program ID (16 hex digits) from a Switch main.npdm: META header, ACI0 block at the offset in 0x70.
async function npdmProgramId(file) {
  try {
    const b = await fsp.readFile(file);
    if (b.toString("latin1", 0, 4) !== "META") return null;
    const off = b.readUInt32LE(0x70);
    if (b.toString("latin1", off, off + 4) !== "ACI0") return null;
    return b.readBigUInt64LE(off + 0x10).toString(16).padStart(16, "0").toUpperCase();
  } catch { return null; }
}

// What kind of folder game a main file belongs to, with its title and ID from the game's own info.
export async function folderGame(file) {
  const base = path.basename(file).toLowerCase();
  const dir = path.dirname(file);
  const sfoIn = async (d) => (await readSfo(path.join(d, "PARAM.SFO"))) || (await readSfo(path.join(d, "param.sfo")));
  if (base === "eboot.bin") {
    if (path.basename(dir).toLowerCase() === "usrdir") {
      // PS3: <game>/PS3_GAME/USRDIR/EBOOT.BIN (disc) or <game>/USRDIR/EBOOT.BIN (PSN).
      let root = path.dirname(dir);
      const sfo = await sfoIn(root);
      if (path.basename(root).toLowerCase() === "ps3_game") root = path.dirname(root);
      return { system: "ps3", root, main: file, title: sfo?.TITLE || null, serial: sfo?.TITLE_ID || null };
    }
    const sfo = await sfoIn(path.join(dir, "sce_sys"));
    if (sfo) {
      // PS Vita title IDs start PCSA-PCSH; everything else with this layout is a PS4 game.
      const id = sfo.TITLE_ID || "";
      return { system: /^PCS[A-H]/.test(id) ? "vita" : "ps4", root: dir, main: file, title: sfo.TITLE || null, serial: id || null };
    }
    return null;
  }
  if (base === "main" && path.basename(dir).toLowerCase() === "exefs") {
    // Unpacked Switch / Switch 2 game: <game>/exefs/main. The program ID in main.npdm tells them
    // apart (Switch 2 titles start 04..., Switch titles 01...).
    const root = path.dirname(dir);
    const id = await npdmProgramId(path.join(dir, "main.npdm"));
    const system = id && id.startsWith("04") ? "switch2" : "switch";
    return { system, root, main: file, title: path.basename(root).replace(/\s*\[[0-9A-Fa-f]{16}\]/g, "").trim() || null, serial: id };
  }
  if (base.endsWith(".rpx") && path.basename(dir).toLowerCase() === "code") {
    // Wii U: <game>/code/<name>.rpx with meta/meta.xml; cos.xml names the program to start.
    const root = path.dirname(dir);
    const cos = await fsp.readFile(path.join(dir, "cos.xml"), "utf8").catch(() => "");
    const want = cos.match(/<argstr[^>]*>([^<]+\.rpx)<\/argstr>/i)?.[1];
    if (want && want.toLowerCase() !== base) return null; // another .rpx in the same folder is the main one
    const meta = await fsp.readFile(path.join(root, "meta", "meta.xml"), "utf8").catch(() => "");
    const title = meta.match(/<longname_en[^>]*>([^<]+)<\/longname_en>/)?.[1]?.replace(/\s+/g, " ").trim() || null;
    return { system: "wiiu", root, main: file, title, serial: meta.match(/<product_code[^>]*>([^<]+)</)?.[1] || null };
  }
  return null;
}

async function totalSize(files) {
  let n = 0;
  for (const f of files) n += (await fsp.stat(f).catch(() => ({ size: 0 }))).size;
  return n;
}

export async function md5File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("md5");
    fs.createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

async function uniqueTarget(dir, name) {
  let target = path.join(dir, name);
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${stem} (${i})${ext}`);
  return target;
}

async function moveFile(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try { await fsp.rename(src, dest); } catch (e) {
    if (e.code !== "EXDEV") throw e;
    await fsp.copyFile(src, dest);
    await fsp.unlink(src);
  }
}

async function moveInto(src, dir, name) {
  const target = path.join(dir, name);
  if (fs.existsSync(target)) { await fsp.unlink(src); return target; } // already have it
  await moveFile(src, target);
  return target;
}

// Moves a game's files together, keeping relative layout so cue sheets still find their tracks.
async function moveGroup(group, destDir) {
  if (group.folder) {
    // A folder game moves as one folder.
    const target = await uniqueTarget(destDir, path.basename(group.folder.root));
    await fsp.mkdir(destDir, { recursive: true });
    try { await fsp.rename(group.folder.root, target); } catch (e) {
      if (e.code !== "EXDEV") throw e;
      await fsp.cp(group.folder.root, target, { recursive: true });
      await fsp.rm(group.folder.root, { recursive: true, force: true });
    }
    return path.join(target, path.relative(group.folder.root, group.main));
  }
  const srcDir = path.dirname(group.main);
  const multi = group.files.length > 1;
  // Multi-file games get their own folder so tracks never collide with other games.
  let base = destDir;
  if (multi) {
    const stem = path.basename(group.main, path.extname(group.main)).replace(/\s*\((?:Disc|Disk|CD)\s*\d+[^)]*\)/i, "").trim();
    base = await uniqueTarget(destDir, stem);
  }
  let destMain = null;
  for (const f of group.files) {
    if (!fs.existsSync(f)) continue;
    const rel = path.relative(srcDir, f);
    const target = multi ? path.join(base, rel.startsWith("..") ? path.basename(f) : rel) : await uniqueTarget(destDir, path.basename(f));
    await moveFile(f, target);
    if (f === group.main) destMain = target;
  }
  return destMain;
}

async function removeEmptyDirs(dir, isRoot = true) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) if (e.isDirectory()) await removeEmptyDirs(path.join(dir, e.name), false);
  if (!isRoot) {
    const left = await fsp.readdir(dir).catch(() => ["x"]);
    if (left.length === 0) await fsp.rmdir(dir).catch(() => {});
  }
}

function debounce(fn, ms) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}
