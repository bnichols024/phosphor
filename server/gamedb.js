// Game database lookups (built by tools/build-db.mjs) and title helpers.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const REGION_CODES = [
  ["USA", "US"], ["America", "US"], ["Canada", "US"], ["World", "World"], ["Europe", "EU"], ["Japan", "JP"],
  ["Korea", "KR"], ["China", "CN"], ["Taiwan", "TW"], ["Hong Kong", "HK"], ["Asia", "Asia"], ["Australia", "AU"],
  ["Brazil", "BR"], ["France", "FR"], ["Germany", "DE"], ["Spain", "ES"], ["Italy", "IT"], ["Netherlands", "NL"],
  ["Sweden", "SE"], ["UK", "UK"], ["Russia", "RU"],
];
const GOODTOOLS = { U: "US", E: "EU", J: "JP", W: "World", UE: "US", JU: "US", JUE: "World", K: "KR", F: "FR", G: "DE", S: "ES", I: "IT", B: "BR", A: "AU", C: "CN" };

// "Super Mario World (USA) (Rev 1)" -> { title: "Super Mario World", region: "US", tags: ["Rev 1"] }
export function parseName(raw) {
  let name = raw.replace(/\.[a-z0-9]{1,4}$/i, "").replace(/_/g, " ").trim();
  const groups = [...name.matchAll(/\s*[([]([^)\]]*)[)\]]/g)].map((m) => m[1].trim());
  let title = name.replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+/g, " ").trim() || name;
  // "Legend of Zelda, The - A Link to the Past" -> "The Legend of Zelda - A Link to the Past"
  title = title.replace(/^(.*?), (The|A|An)(\b.*)$/i, (_, a, art, rest) => `${art} ${a}${rest}`);
  let region = null;
  const tags = [];
  for (const g of groups) {
    if (!region) {
      const hit = REGION_CODES.find(([word]) => g.split(/,\s*/).includes(word));
      if (hit) { region = hit[1]; if (g.includes("USA") && g.includes("Europe")) region = "World"; continue; }
      if (GOODTOOLS[g]) { region = GOODTOOLS[g]; continue; }
    }
    if (/^(En|Fr|De|Es|It|Ja|Nl|Pt|Sv|No|Da|Fi|Zh|Ko|Pl|Ru)(,|$)/.test(g)) continue; // language lists
    if (/^!$|^v?\d+(\.\d+)*$/i.test(g) && !/^v/i.test(g)) continue;
    tags.push(g);
  }
  const disc = (() => { const m = raw.match(/\((?:Disc|Disk|CD)\s*(\d+)(?:\s*of\s*\d+)?\)/i); return m ? Number(m[1]) : null; })();
  return { title, region, tags, disc };
}

// Lower-case, no punctuation, no articles: for fuzzy matching names that don't match exactly.
export function normTitle(s) {
  return s.toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]/g, "")
    .replace(/&/g, " and ")
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sortTitle(title) {
  return title.toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9 ]/g, "").trim();
}

export class GameDB {
  constructor(dir) { this.dir = dir; this.cache = new Map(); }

  load(system) {
    if (this.cache.has(system)) return this.cache.get(system);
    let db = null;
    try {
      const file = path.join(this.dir, `${system}.json.gz`);
      db = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
      db.serials ||= {};
    } catch { db = null; }
    this.cache.set(system, db);
    return db;
  }

  _row(db, idx) {
    if (!db || idx === undefined || idx === null) return null;
    const [name, year, genre, players, developer, publisher] = db.games[idx];
    return { name, year, genre, players, developer, publisher };
  }

  byCrc(system, crc) { const db = this.load(system); return crc ? this._row(db, db?.crc[crc.toUpperCase()]) : null; }
  bySerial(system, serial) { const db = this.load(system); return serial ? this._row(db, db?.serials[serial]) : null; }
  // Redump lists GameCube/Wii discs as "DL-DOL-GALE-USA" / "RVL-RMGE-USA": the disc's own 4-letter
  // code is in the middle, so match on the start.
  bySerialPrefix(system, prefix) {
    const db = this.load(system);
    if (!db || !prefix) return null;
    const keys = Object.keys(db.serials).filter((k) => k.startsWith(prefix));
    // The code's last letter is its region (E USA, P Europe, J Japan...): prefer that release.
    const region = { E: "USA", P: "EUR", J: "JPN", K: "KOR", D: "GER", F: "FRA", S: "ESP", I: "ITA", U: "AUS" }[prefix.at(-1)];
    const key = keys.find((k) => region && k.slice(prefix.length).startsWith(region)) || keys[0];
    return key ? this._row(db, db.serials[key]) : null;
  }
  byFile(system, base) { const db = this.load(system); return this._row(db, db?.files[base.toLowerCase()]); }

  // Best fuzzy match by normalised title, preferring the user's region order.
  byTitle(system, title, regionOrder = ["US", "World", "EU", "JP"]) {
    const db = this.load(system);
    if (!db) return null;
    if (!db._norm) {
      db._norm = new Map();
      db.games.forEach((g, i) => {
        const k = normTitle(g[0]);
        if (!db._norm.has(k)) db._norm.set(k, []);
        db._norm.get(k).push(i);
      });
    }
    const hits = db._norm.get(normTitle(title));
    if (!hits) return null;
    const ranked = hits.map((i) => {
      const p = parseName(db.games[i][0]);
      const r = regionOrder.indexOf(p.region);
      return { i, score: (r === -1 ? 9 : r) * 10 + p.tags.length };
    }).sort((a, b) => a.score - b.score);
    return this._row(db, ranked[0].i);
  }
}
