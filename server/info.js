// Game descriptions (and, with ScreenScraper, ratings, gameplay videos and manuals). Fetched in the
// background like box art. ScreenScraper is used when credentials are set up; otherwise Wikipedia,
// which needs no account. Only an article that is clearly about this exact video game is used.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { BY_ID } from "./systems.js";
import { normTitle, parseName } from "./gamedb.js";

const ssBase = () => process.env.PHOSPHOR_SCREENSCRAPER_URL || "https://api.screenscraper.fr/api2";
const wikiBase = () => process.env.PHOSPHOR_WIKIPEDIA_URL || "https://en.wikipedia.org";
const UA = "Phosphor/1.7 (retro gaming app; https://github.com/bnichols024/phosphor)";

// ScreenScraper system ids.
export const SS_SYSTEMS = {
  nes: 3, snes: 4, n64: 14, gb: 9, gbc: 10, gba: 12, nds: 15, vb: 11, sms: 2, genesis: 1, gamegear: 21, sg1000: 109,
  "32x": 19, saturn: 22, segacd: 20, psx: 57, psp: 61, atari2600: 26, atari5200: 40, atari7800: 41, jaguar: 27, lynx: 28,
  pce: 31, pcecd: 114, ngp: 82, wonderswan: 45, coleco: 48, "3do": 29, arcade: 75, c64: 66, amiga: 64, dos: 135,
  zxspectrum: 76, cpc: 65,
};

const pick = (list, lang = "en") => (Array.isArray(list) ? (list.find((x) => x.langue === lang) || list.find((x) => x.langue === "us") || list[0])?.text : null) || null;

export class GameInfo {
  constructor({ db, library, dir, log = console }) {
    this.db = db;
    this.library = library;
    this.dir = dir; // cache for videos
    this.log = log;
    this.queue = [];
    this.queued = new Set();
    this.running = 0;
    this.onInfo = null;
    this.paused = false;
  }

  credentials() {
    const s = this.db.getSetting("screenscraper", {}) || {};
    return {
      devid: process.env.PHOSPHOR_SS_DEVID || s.devid || "",
      devpassword: process.env.PHOSPHOR_SS_DEVPASSWORD || s.devpassword || "",
      user: s.user || "",
      password: s.password || "",
    };
  }
  screenscraperReady() { const c = this.credentials(); return !!(c.devid && c.devpassword); }

  enqueueMissing() {
    for (const r of this.db.all("SELECT id FROM games WHERE info_checked = 0 AND missing_since IS NULL ORDER BY id")) this.enqueue(r.id);
  }
  enqueue(id) {
    if (this.queued.has(id)) return;
    this.queued.add(id);
    this.queue.push(id);
    this._pump();
  }
  // Re-check everything (after ScreenScraper is connected).
  refetchAll() {
    this.db.run("UPDATE games SET info_checked = 0");
    this.enqueueMissing();
  }
  _pump() {
    while (this.running < 2 && this.queue.length && !this.paused) {
      const id = this.queue.shift();
      this.running++;
      this.fetchFor(id).catch((e) => this.log.warn?.(`info ${id}: ${e.message}`)).finally(() => {
        this.running--;
        this.queued.delete(id);
        setTimeout(() => this._pump(), 250); // be gentle with free APIs
      });
    }
  }

  async _json(url, opts = {}) {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20000), ...opts });
    const text = await res.text();
    if (!res.ok) { const e = new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`); e.status = res.status; throw e; }
    try { return JSON.parse(text); } catch { throw new Error(text.slice(0, 160).trim() || "bad response"); }
  }

  async fetchFor(id) {
    const g = this.db.get("SELECT * FROM games WHERE id = ?", id);
    if (!g) return;
    let info = null;
    if (this.screenscraperReady() && SS_SYSTEMS[g.system]) {
      try { info = await this.screenscraper(g); } catch (e) {
        // Quota or login trouble: try again later rather than marking the game done.
        if (/quota|identifiants|login|429|430|431/i.test(e.message)) { this.log.warn?.(`screenscraper: ${e.message}`); this.paused = true; setTimeout(() => { this.paused = false; this._pump(); }, 10 * 60e3); this.queue.unshift(id); this.queued.add(id); return; }
        info = null;
      }
    }
    if (!info?.description) {
      try {
        const w = await this.wikipedia(g);
        if (w) info = { ...(info || {}), ...w, rating: info?.rating ?? null, video: info?.video ?? null, manual: info?.manual ?? null };
      } catch (e) { if (e.cause?.code === "ENOTFOUND" || e.name === "TimeoutError") return; } // offline: retry next time
    }
    this.db.run("UPDATE games SET description = ?, desc_source = ?, desc_url = ?, rating = ?, video_url = ?, manual_url = ?, info_checked = 1 WHERE id = ?",
      info?.description || null, info?.source || null, info?.url || null, info?.rating ?? null, info?.video || null, info?.manual || null, id);
    if (info?.description && this.onInfo) this.onInfo(id);
  }

  // ---- ScreenScraper ----
  ssParams(extra = {}) {
    const c = this.credentials();
    return new URLSearchParams({ devid: c.devid, devpassword: c.devpassword, softname: "Phosphor", output: "json", ...(c.user ? { ssid: c.user, sspassword: c.password } : {}), ...extra });
  }

  async screenscraper(g) {
    const files = JSON.parse(g.files);
    const main = this.library.absPath(files[0]);
    const st = await fsp.stat(main).catch(() => null);
    const q = { systemeid: String(SS_SYSTEMS[g.system]), romtype: "rom", romnom: path.basename(main), romtaille: String(st?.size || 0) };
    if (g.crc) q.crc = g.crc;
    let data;
    try {
      data = await this._json(`${ssBase()}/jeuInfos.php?${this.ssParams(q)}`);
    } catch (e) {
      if (e.status === 404 || /non trouv|not found/i.test(e.message)) return null;
      throw e;
    }
    const jeu = data?.response?.jeu;
    if (!jeu) return null;
    const medias = jeu.medias || [];
    const media = (type) => medias.find((m) => m.type === type && (m.region === "us" || m.region === "wor" || !m.region)) || medias.find((m) => m.type === type);
    const note = Number(jeu.note?.text);
    return {
      description: pick(jeu.synopsis),
      source: "ScreenScraper",
      url: jeu.id ? `https://www.screenscraper.fr/gameinfos.php?gameid=${jeu.id}` : null,
      rating: Number.isFinite(note) ? Math.round((note / 20) * 50) / 10 : null, // out of 5
      video: media("video-normalized")?.url || media("video")?.url || null,
      manual: media("manuel")?.url || null,
    };
  }

  // Gameplay video, cached on disk the first time someone opens it (ScreenScraper media URLs carry
  // credentials, so the browser only ever sees our own URL).
  async videoFile(g) {
    if (!g.video_url) return null;
    const file = path.join(this.dir, `video-${g.id}.mp4`);
    if (fs.existsSync(file)) return file;
    const res = await fetch(g.video_url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(120000) });
    if (!res.ok) return null;
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
    return file;
  }

  // ---- Wikipedia ----
  async wikipedia(g) {
    const title = parseName(g.custom_title || g.title).title;
    const found = await this._wikiTitle(g, title);
    // "Cave Story - Doukutsu Monogatari": if the full name finds nothing, try the main title alone.
    const short = title.split(/ - |: /)[0];
    if (!found && short !== title && short.length > 3) return this._wikiTitle(g, short);
    return found;
  }

  async _wikiTitle(g, title) {
    const sys = BY_ID[g.system];
    const want = normTitle(title);
    if (!want || want.length < 2) return null;
    const search = await this._json(`${wikiBase()}/w/api.php?${new URLSearchParams({ action: "query", list: "search", srsearch: `${title} ${sys.short} video game`, srlimit: "6", format: "json", origin: "*" })}`);
    const hits = search?.query?.search || [];
    for (const h of hits) {
      const m = /^(.*?)(?:\s*\(([^)]*)\))?$/.exec(h.title);
      const base = m[1], qual = (m[2] || "").toLowerCase();
      if (normTitle(base) !== want) continue;
      if (qual && !/video game|game/.test(qual)) continue;
      const sum = await this._json(`${wikiBase()}/api/rest_v1/page/summary/${encodeURIComponent(h.title.replace(/ /g, "_"))}`).catch(() => null);
      if (!sum || sum.type === "disambiguation") continue;
      if (!/video game|game/i.test(`${sum.description || ""} ${sum.extract?.slice(0, 200) || ""}`)) continue;
      return { description: sum.extract, source: "Wikipedia", url: sum.content_urls?.desktop?.page || `${wikiBase()}/wiki/${encodeURIComponent(h.title)}` };
    }
    return null;
  }
}
