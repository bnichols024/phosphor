// RetroAchievements (read-only): finds each game by RetroAchievements' own ROM hash, then shows its
// achievements and the player's progress using their Web API key. Earning achievements needs an
// emulator that RetroAchievements has approved, which the in-browser emulators aren't (yet).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { listZip, readZipEntry } from "./lib/zip.js";

const raBase = () => process.env.PHOSPHOR_RA_URL || "https://retroachievements.org";
const MEDIA = "https://media.retroachievements.org";

// RetroAchievements console ids for the systems whose hash is simply the ROM data.
export const RA_CONSOLES = {
  nes: 7, snes: 3, n64: 2, gb: 4, gbc: 6, gba: 5, vb: 28, sms: 11, genesis: 1, gamegear: 15, sg1000: 33, "32x": 10,
  pce: 8, ngp: 14, wonderswan: 53, atari2600: 25, atari7800: 51, jaguar: 17, lynx: 13, coleco: 44,
};

// Hash rules from rcheevos (rc_hash): strip copier/iNES headers, normalise N64 byte order.
export function raHash(system, buf) {
  let data = buf;
  if (system === "nes" && data.toString("latin1", 0, 4) === "NES\x1a") data = data.subarray(16);
  else if (system === "nes" && data.toString("latin1", 0, 4) === "FDS\x1a") data = data.subarray(16);
  else if (system === "snes" && data.length % 8192 === 512) data = data.subarray(512);
  else if (system === "lynx" && data.toString("latin1", 0, 4) === "LYNX") data = data.subarray(64);
  else if (system === "atari7800" && data.toString("latin1", 1, 10) === "ATARI7800") data = data.subarray(128);
  else if (system === "n64") {
    const magic = data.readUInt32BE(0);
    if (magic === 0x37804012) { data = Buffer.from(data); for (let i = 0; i + 1 < data.length; i += 2) { const t = data[i]; data[i] = data[i + 1]; data[i + 1] = t; } }
    else if (magic === 0x40123780) { data = Buffer.from(data); for (let i = 0; i + 3 < data.length; i += 4) { const a = data[i], b = data[i + 1]; data[i] = data[i + 3]; data[i + 1] = data[i + 2]; data[i + 2] = b; data[i + 3] = a; } }
  }
  return crypto.createHash("md5").update(data).digest("hex");
}

export class Achievements {
  constructor({ db, library, dir, log = console }) {
    this.db = db;
    this.library = library;
    this.dir = dir;
    this.log = log;
    this.cache = new Map(); // `${profile}:${game}` -> { at, data }
  }

  account(profileId) { return this.db.getSetting(`ra:${profileId}`, null); }
  setAccount(profileId, acct) { this.db.setSetting(`ra:${profileId}`, acct); this.cache.clear(); }

  async _get(endpoint, params, key) {
    const url = `${raBase()}/API/${endpoint}?${new URLSearchParams({ ...params, y: key })}`;
    const res = await fetch(url, { headers: { "user-agent": "Phosphor/1.4" }, signal: AbortSignal.timeout(20000) });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error("RetroAchievements didn't accept that username and API key."), { status: 401 });
    if (!res.ok) throw new Error(`RetroAchievements answered ${res.status}`);
    return res.json();
  }

  async verify(user, key) {
    const p = await this._get("API_GetUserProfile.php", { u: user }, key);
    if (!p || !p.User) throw Object.assign(new Error("RetroAchievements didn't find that user."), { status: 401 });
    return { user: p.User, avatar: p.UserPic ? `${MEDIA}${p.UserPic}` : null, points: p.TotalPoints ?? null };
  }

  async hashFor(g) {
    if (g.ra_hash) return g.ra_hash;
    if (!RA_CONSOLES[g.system]) return null;
    const file = this.library.absPath(JSON.parse(g.files)[0]);
    let buf;
    if (/\.zip$/i.test(file)) {
      const entries = (await listZip(file)) || [];
      const rom = entries.sort((a, b) => b.usize - a.usize)[0];
      buf = rom ? await readZipEntry(file, rom) : null;
    } else {
      const st = await fsp.stat(file);
      if (st.size > 128 * 1024 * 1024) return null;
      buf = await fsp.readFile(file);
    }
    if (!buf) return null;
    const h = raHash(g.system, buf);
    this.db.run("UPDATE games SET ra_hash = ? WHERE id = ?", h, g.id);
    return h;
  }

  // Every game RetroAchievements knows for a console, with its accepted hashes (cached a week).
  async hashIndex(consoleId, key) {
    const file = path.join(this.dir, `ra-console-${consoleId}.json`);
    try {
      const st = await fsp.stat(file);
      if (Date.now() - st.mtimeMs < 7 * 86400e3) return JSON.parse(await fsp.readFile(file, "utf8"));
    } catch { /* not cached */ }
    const list = await this._get("API_GetGameList.php", { i: String(consoleId), h: "1", f: "1" }, key);
    const idx = {};
    for (const g of list || []) for (const h of g.Hashes || []) idx[String(h).toLowerCase()] = g.ID;
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(file, JSON.stringify(idx));
    return idx;
  }

  async forGame(profileId, g) {
    const acct = this.account(profileId);
    if (!acct) return { connected: false };
    if (!RA_CONSOLES[g.system]) return { connected: true, supported: false, reason: "Achievements for this console aren't shown yet." };
    const ck = `${profileId}:${g.id}`;
    const hit = this.cache.get(ck);
    if (hit && Date.now() - hit.at < 5 * 60e3) return hit.data;
    const hash = await this.hashFor(g);
    const idx = await this.hashIndex(RA_CONSOLES[g.system], acct.key);
    const gameId = hash && idx[hash];
    if (!gameId) {
      const data = { connected: true, supported: true, found: false, user: acct.user };
      this.cache.set(ck, { at: Date.now(), data });
      return data;
    }
    const p = await this._get("API_GetGameInfoAndUserProgress.php", { u: acct.user, g: String(gameId), a: "1" }, acct.key);
    const list = Object.values(p.Achievements || {}).sort((a, b) => (a.DisplayOrder - b.DisplayOrder) || (a.ID - b.ID)).map((a) => ({
      id: a.ID, title: a.Title, description: a.Description, points: a.Points,
      badge: `${MEDIA}/Badge/${a.BadgeName}.png`, badgeLocked: `${MEDIA}/Badge/${a.BadgeName}_lock.png`,
      earned: a.DateEarned || null, earnedHardcore: a.DateEarnedHardcore || null,
    }));
    const data = {
      connected: true, supported: true, found: true, user: acct.user,
      game: { id: gameId, title: p.Title, url: `${raBase()}/game/${gameId}`, icon: p.ImageIcon ? `${MEDIA}${p.ImageIcon}` : null },
      total: list.length, earned: list.filter((a) => a.earned).length,
      points: list.reduce((s, a) => s + (a.points || 0), 0), earnedPoints: list.filter((a) => a.earned).reduce((s, a) => s + (a.points || 0), 0),
      achievements: list,
    };
    this.cache.set(ck, { at: Date.now(), data });
    return data;
  }
}
