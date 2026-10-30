// Box art, screenshots and title screens from the libretro thumbnail library (free, no account).
// Fetched in the background after scans and cached on disk, so the UI only ever loads local files.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { BY_ID } from "./systems.js";
import { normTitle, parseName } from "./gamedb.js";

const HOST = process.env.PHOSPHOR_THUMBS || "https://thumbnails.libretro.com";
const KINDS = { box: "Named_Boxarts", snap: "Named_Snaps", title: "Named_Titles" };
// libretro thumbnail names replace these characters with underscores.
const safeName = (n) => n.replace(/[&*/:`<>?\\|"]/g, "_");

export class Media {
  constructor({ dir, db, log = console }) {
    this.dir = dir;
    this.db = db;
    this.log = log;
    this.queue = [];
    this.queued = new Set();
    this.running = 0;
    this.listings = new Map(); // "system|kind" -> Map(norm -> name)
    this.offline = false;
    this.onArt = null;
  }

  file(name) {
    if (!name || name.includes("/") || name.includes("..")) return null;
    const p = path.join(this.dir, name);
    return fs.existsSync(p) ? p : null;
  }

  enqueueMissing() {
    const rows = this.db.all("SELECT id FROM games WHERE art_checked = 0 AND missing_since IS NULL ORDER BY id");
    for (const r of rows) this.enqueue(r.id);
  }

  enqueue(id) {
    if (this.queued.has(id)) return;
    this.queued.add(id);
    this.queue.push(id);
    this._pump();
  }

  _pump() {
    while (this.running < 4 && this.queue.length) {
      const id = this.queue.shift();
      this.running++;
      this.fetchFor(id).catch((e) => this.log.warn?.(`art ${id}: ${e.message}`)).finally(() => {
        this.running--;
        this.queued.delete(id);
        this._pump();
      });
    }
  }

  async _get(url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      this.offline = false;
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (e.name === "TimeoutError" || e.cause?.code === "ENOTFOUND" || e.cause?.code === "EAI_AGAIN") this.offline = true;
      return null;
    }
  }

  // Directory listing of every thumbnail name for a system, for fuzzy matching odd filenames.
  async _listing(thumbSystem, kind) {
    const key = `${thumbSystem}|${kind}`;
    if (this.listings.has(key)) return this.listings.get(key);
    const p = this._listingFetch(thumbSystem, kind);
    this.listings.set(key, p);
    return p;
  }

  async _listingFetch(thumbSystem, kind) {
    const cacheFile = path.join(this.dir, "_listings", `${safeName(thumbSystem)}-${kind}.json`);
    try {
      const st = await fsp.stat(cacheFile);
      if (Date.now() - st.mtimeMs < 7 * 86400e3) return new Map(JSON.parse(await fsp.readFile(cacheFile, "utf8")));
    } catch { /* not cached yet */ }
    const buf = await this._get(`${HOST}/${encodeURIComponent(thumbSystem)}/${KINDS[kind]}/`);
    const map = new Map();
    if (buf) {
      for (const m of buf.toString("utf8").matchAll(/href="([^"]+)\.png"/g)) {
        const name = decodeURIComponent(m[1]);
        const k = normTitle(name);
        const prev = map.get(k);
        // Prefer USA/World versions when several regions normalise to the same key.
        if (!prev || (/(USA|World)/.test(name) && !/(USA|World)/.test(prev))) map.set(k, name);
      }
      await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
      await fsp.writeFile(cacheFile, JSON.stringify([...map]));
    }
    return map;
  }

  async fetchFor(id) {
    const g = this.db.get("SELECT id, system, title, db_name, path, custom_title FROM games WHERE id = ?", id);
    if (!g) return;
    const sys = BY_ID[g.system];
    const names = [];
    if (g.db_name) names.push(g.db_name);
    const fileBase = path.basename(g.path, path.extname(g.path));
    names.push(fileBase);
    const got = {};
    for (const kind of Object.keys(KINDS)) {
      for (const thumbSystem of sys.thumbs) {
        if (got[kind]) break;
        for (const n of names) {
          const buf = await this._get(`${HOST}/${encodeURIComponent(thumbSystem)}/${KINDS[kind]}/${encodeURIComponent(safeName(n))}.png`);
          if (buf && buf.length > 200) { got[kind] = await this._save(g, kind, buf); break; }
        }
        if (!got[kind]) {
          // Fuzzy: same normalised title in the system's thumbnail listing.
          const listing = await this._listing(thumbSystem, kind);
          const want = normTitle(g.custom_title || parseName(g.db_name || fileBase).title);
          const hit = listing.get(want) || listing.get(normTitle(g.db_name || fileBase));
          if (hit) {
            const buf = await this._get(`${HOST}/${encodeURIComponent(thumbSystem)}/${KINDS[kind]}/${encodeURIComponent(hit)}.png`);
            if (buf && buf.length > 200) got[kind] = await this._save(g, kind, buf);
          }
        }
      }
      if (this.offline) break;
    }
    if (this.offline) return; // try again on the next scan
    this.db.run("UPDATE games SET art_box = ?, art_snap = ?, art_title = ?, art_checked = 1 WHERE id = ?",
      got.box || null, got.snap || null, got.title || null, id);
    if (this.onArt && (got.box || got.snap || got.title)) this.onArt(id);
  }

  async _save(g, kind, buf) {
    const name = `${g.system}-${crypto.createHash("sha1").update(`${g.id}:${kind}:${buf.length}`).digest("hex").slice(0, 16)}-${kind}.png`;
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(path.join(this.dir, name), buf);
    return name;
  }

  async setCustom(id, kind, buf, ext = "png") {
    const g = this.db.get("SELECT id, system FROM games WHERE id = ?", id);
    if (!g || !KINDS[kind]) throw new Error("bad art request");
    const name = `${g.system}-${crypto.randomBytes(8).toString("hex")}-${kind}.${ext}`;
    await fsp.writeFile(path.join(this.dir, name), buf);
    this.db.run(`UPDATE games SET art_${kind} = ? WHERE id = ?`, name, id);
    return name;
  }
}
