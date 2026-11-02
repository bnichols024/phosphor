// REST API. Every per-player route reads the player from the x-profile header.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Router, HttpError, json, readBody, readJson, sendFile } from "./http.js";
import { SYSTEMS, BY_ID, publicSystem } from "./systems.js";
import { NATIVE } from "./native/catalog.js";
import { parseName, sortTitle } from "./gamedb.js";

const AVATARS = ["👾", "🍄", "⭐", "🦔", "🐉", "🚀", "🎯", "🕹️", "👻", "🐢", "🦊", "⚡"];
const COLORS = ["#7c5cff", "#ff5c8a", "#22c55e", "#f59e0b", "#06b6d4", "#ef4444", "#a855f7", "#14b8a6"];
const SAVE_HISTORY = 8;

export function buildApi(ctx) {
  const { db, library, media, emulators, bus, paths, version, freeGames, info, achievements, native = null, runner = null } = ctx;
  const r = new Router();

  // ---- helpers ----
  const profileOf = (req) => {
    const id = Number(req.headers["x-profile"] || new URL(req.url, "http://x").searchParams.get("profile"));
    const p = (id && db.get("SELECT * FROM profiles WHERE id = ?", id)) || db.get("SELECT * FROM profiles ORDER BY id LIMIT 1");
    if (!p) throw new HttpError(500, "No player profile exists.");
    return p;
  };
  const gameOr404 = (id) => {
    const g = db.get("SELECT * FROM games WHERE id = ?", Number(id));
    if (!g) throw new HttpError(404, "That game isn't in the library anymore.");
    return g;
  };
  const artUrl = (name) => (name ? `/media/${encodeURIComponent(name)}` : null);
  const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "game";
  const statesDir = (pid, gid) => path.join(paths.internal, "states", String(pid), String(gid));

  const gameRow = (g, play) => ({
    id: g.id, system: g.system, title: g.custom_title || g.title, region: g.region, year: g.year, genre: g.genre,
    players: g.players, discs: g.discs, matched: !!g.matched,
    box: artUrl(g.art_box), snap: artUrl(g.art_snap), titleArt: artUrl(g.art_title), artChecked: !!g.art_checked,
    favorite: !!play?.favorite, lastPlayed: play?.last_played || null, seconds: play?.seconds || 0, addedAt: g.added_at,
  });

  // Kid mode: a kid profile only sees the consoles a parent allowed (all, if none picked).
  const kidSystems = (profile) => {
    const st = JSON.parse(profile.settings || "{}");
    return st.kid && Array.isArray(st.systems) && st.systems.length ? new Set(st.systems) : null;
  };
  const pinHash = (pin) => crypto.createHash("sha256").update(`phosphor:${pin}`).digest("hex");

  const playsFor = (pid) => new Map(db.all("SELECT * FROM plays WHERE profile_id = ?", pid).map((p) => [p.game_id, p]));

  const biosReady = async () => {
    const st = await library.biosStatus();
    return Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.ready]));
  };

  // ---- app state ----
  r.get("/api/state", async (req, res) => {
    const profile = profileOf(req);
    const counts = Object.fromEntries(db.all("SELECT system, COUNT(*) n FROM games WHERE missing_since IS NULL GROUP BY system").map((x) => [x.system, x.n]));
    const ready = await biosReady();
    json(res, 200, {
      version,
      profile: publicProfile(profile),
      profiles: db.all("SELECT * FROM profiles ORDER BY id").map(publicProfile),
      systems: SYSTEMS.filter((s) => !(s.bios?.required && !ready[s.id]) && (!kidSystems(profile) || kidSystems(profile).has(s.id))).map((s) => ({ ...publicSystem(s), count: counts[s.id] || 0, locked: !!(s.needs && !ready[s.id]), emulatorReady: s.native ? !!native?.exePath(s.native) : emulators.hasCore(s.core) })),
      hiddenSystems: SYSTEMS.filter((s) => s.bios?.required && !ready[s.id]).map((s) => ({ id: s.id, name: s.name, games: counts[s.id] || 0, biosFiles: s.bios.files.map((f) => f.name) })),
      library: { ...library.status, root: paths.root, dropFolder: library.dropDir, total: SYSTEMS.filter((s) => !(s.bios?.required && !ready[s.id])).reduce((a, s) => a + (counts[s.id] || 0), 0) },
      emulators: emulators.summary(),
      desktop: !!runner,
      settings: { ...settings(), parentPin: undefined, hasPin: !!db.getSetting("parentPin", null) },
    });
  });

  const DEFAULT_SETTINGS = { regionOrder: ["US", "World", "EU", "JP"], groupRegions: true, sounds: true, reduceMotion: false, screensaver: 5 };
  const settings = () => ({ ...DEFAULT_SETTINGS, ...db.getSetting("app", {}) });
  r.get("/api/settings", (req, res) => json(res, 200, { ...settings(), hasPin: !!db.getSetting("parentPin", null) }));
  r.patch("/api/settings", async (req, res) => {
    const body = await readJson(req);
    const next = { ...settings() };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in body) next[k] = body[k];
    db.setSetting("app", next);
    json(res, 200, next);
  });

  // ---- parent PIN (guards Settings and leaving a kid profile) ----
  r.post("/api/parent/pin", async (req, res) => {
    const { pin, current } = await readJson(req);
    const stored = db.getSetting("parentPin", null);
    if (stored && pinHash(String(current || "")) !== stored) throw new HttpError(403, "That's not the current PIN.");
    if (pin && !/^\d{4}$/.test(String(pin))) throw new HttpError(400, "Use 4 digits.");
    db.setSetting("parentPin", pin ? pinHash(String(pin)) : null);
    json(res, 200, { hasPin: !!pin });
  });
  r.post("/api/parent/check", async (req, res) => {
    const { pin } = await readJson(req);
    const stored = db.getSetting("parentPin", null);
    json(res, 200, { ok: !stored || pinHash(String(pin || "")) === stored });
  });

  // ---- profiles ----
  const publicProfile = (p) => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, settings: JSON.parse(p.settings || "{}") });
  r.get("/api/profiles", (req, res) => json(res, 200, db.all("SELECT * FROM profiles ORDER BY id").map(publicProfile)));
  r.post("/api/profiles", async (req, res) => {
    const b = await readJson(req);
    const n = db.get("SELECT COUNT(*) n FROM profiles").n;
    const name = String(b.name || `Player ${n + 1}`).trim().slice(0, 24);
    const info = db.run("INSERT INTO profiles(name, color, avatar, created_at) VALUES(?,?,?,?)", name, b.color || COLORS[n % COLORS.length], b.avatar || AVATARS[n % AVATARS.length], Date.now());
    json(res, 201, publicProfile(db.get("SELECT * FROM profiles WHERE id = ?", Number(info.lastInsertRowid))));
  });
  r.patch("/api/profiles/:id", async (req, res, { id }) => {
    const p = db.get("SELECT * FROM profiles WHERE id = ?", Number(id));
    if (!p) throw new HttpError(404, "No such player.");
    const b = await readJson(req);
    const merged = { ...JSON.parse(p.settings || "{}"), ...(b.settings || {}) };
    db.run("UPDATE profiles SET name = ?, color = ?, avatar = ?, settings = ? WHERE id = ?",
      String(b.name ?? p.name).trim().slice(0, 24) || p.name, b.color ?? p.color, b.avatar ?? p.avatar, JSON.stringify(merged), p.id);
    json(res, 200, publicProfile(db.get("SELECT * FROM profiles WHERE id = ?", p.id)));
  });
  r.delete("/api/profiles/:id", (req, res, { id }) => {
    if (db.get("SELECT COUNT(*) n FROM profiles").n <= 1) throw new HttpError(400, "You need at least one player.");
    db.tx(() => {
      for (const t of ["plays", "sessions", "states", "saves"]) db.run(`DELETE FROM ${t} WHERE profile_id = ?`, Number(id));
      db.run("DELETE FROM collection_games WHERE collection_id IN (SELECT id FROM collections WHERE profile_id = ?)", Number(id));
      db.run("DELETE FROM collections WHERE profile_id = ?", Number(id));
      db.run("DELETE FROM profiles WHERE id = ?", Number(id));
    });
    // Save files stay on disk in Saves/<name>/ so nothing is lost by accident.
    json(res, 200, { ok: true });
  });

  // ---- games ----
  r.get("/api/games", async (req, res) => {
    const profile = profileOf(req);
    const q = new URL(req.url, "http://x").searchParams;
    const where = ["missing_since IS NULL"];
    const args = [];
    const locked = [...(await library.lockedSystems())];
    if (locked.length) { where.push(`system NOT IN (${locked.map(() => "?").join(",")})`); args.push(...locked); }
    if (q.get("system")) { where.push("system = ?"); args.push(q.get("system")); }
    if (q.get("ids")) {
      const ids = q.get("ids").split(",").map(Number).filter(Boolean).slice(0, 500);
      where.push(`id IN (${ids.map(() => "?").join(",") || "NULL"})`);
      args.push(...ids);
    }
    if (q.get("q")) {
      for (const word of q.get("q").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
        where.push("(LOWER(IFNULL(custom_title, title)) LIKE ? OR LOWER(IFNULL(genre,'')) LIKE ? OR LOWER(IFNULL(developer,'')) LIKE ?)");
        args.push(`%${word}%`, `${word}%`, `${word}%`);
      }
    }
    if (q.get("collection")) { where.push("id IN (SELECT game_id FROM collection_games WHERE collection_id = ?)"); args.push(Number(q.get("collection"))); }
    const allowed = kidSystems(profile);
    let rows = db.all(`SELECT * FROM games WHERE ${where.join(" AND ")} ORDER BY sort_title`, ...args).filter((g) => !allowed || allowed.has(g.system));
    const plays = playsFor(profile.id);
    let out = rows.map((g) => gameRow(g, plays.get(g.id)));
    if (q.get("favorites") === "1") out = out.filter((g) => g.favorite);
    if (q.get("played") === "1") out = out.filter((g) => g.lastPlayed);
    const sort = q.get("sort") || "az";
    if (sort === "recent") out.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    else if (sort === "added") out.sort((a, b) => b.addedAt - a.addedAt);
    else if (sort === "played") out.sort((a, b) => b.seconds - a.seconds);
    else if (sort === "year") out.sort((a, b) => (a.year || 9999) - (b.year || 9999));
    const limit = Math.min(Number(q.get("limit")) || 100000, 100000);
    json(res, 200, out.slice(0, limit));
  });

  r.get("/api/home", async (req, res) => {
    const profile = profileOf(req);
    const plays = playsFor(profile.id);
    const locked = await library.lockedSystems();
    const allowed = kidSystems(profile);
    const all = db.all("SELECT * FROM games WHERE missing_since IS NULL").filter((g) => !locked.has(g.system) && (!allowed || allowed.has(g.system)));
    const rows = all.map((g) => gameRow(g, plays.get(g.id)));
    const byId = new Map(rows.map((g) => [g.id, g]));
    const resumable = new Map(db.all("SELECT game_id, created_at FROM states WHERE profile_id = ? AND slot = 0", profile.id).map((s) => [s.game_id, s.created_at]));
    const recent = rows.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 16).map((g) => ({
      ...g, resumable: resumable.has(g.id),
      resumeThumb: resumable.has(g.id) ? `/api/games/${g.id}/states/0/thumb?profile=${profile.id}&t=${resumable.get(g.id)}` : null,
    }));
    const favorites = rows.filter((g) => g.favorite).sort((a, b) => a.title.localeCompare(b.title)).slice(0, 30);
    const added = [...rows].sort((a, b) => b.addedAt - a.addedAt).slice(0, 16);
    // "Rediscover": art-rich games this player never touched, shuffled daily.
    const day = Math.floor(Date.now() / 86400000);
    const unplayed = rows.filter((g) => !g.lastPlayed && g.box).sort((a, b) => hash(`${day}:${a.id}`) - hash(`${day}:${b.id}`)).slice(0, 16);
    const week = Date.now() - 7 * 86400e3;
    const weekSeconds = db.get("SELECT IFNULL(SUM(seconds),0) s FROM sessions WHERE profile_id = ? AND started_at > ?", profile.id, week).s;
    const totalSeconds = db.get("SELECT IFNULL(SUM(seconds),0) s FROM plays WHERE profile_id = ?", profile.id).s;
    const top = db.all("SELECT game_id, seconds FROM plays WHERE profile_id = ? AND seconds > 0 ORDER BY seconds DESC LIMIT 1", profile.id)[0];
    json(res, 200, {
      recent, favorites, added, rediscover: unplayed,
      stats: { games: rows.length, weekSeconds, totalSeconds, topGame: top ? byId.get(top.game_id) || null : null, systems: new Set(rows.map((g) => g.system)).size },
    });
  });

  r.get("/api/games/:id", (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    if (!g.info_checked) info.enqueue(g.id);
    const play = db.get("SELECT * FROM plays WHERE profile_id = ? AND game_id = ?", profile.id, g.id);
    const states = db.all("SELECT slot, size, created_at, core FROM states WHERE profile_id = ? AND game_id = ? ORDER BY slot", profile.id, g.id)
      .map((s) => ({ slot: s.slot, size: s.size, createdAt: s.created_at, thumb: `/api/games/${g.id}/states/${s.slot}/thumb?profile=${profile.id}&t=${s.created_at}` }));
    const save = db.get("SELECT size, updated_at FROM saves WHERE profile_id = ? AND game_id = ?", profile.id, g.id);
    const variants = db.all("SELECT id, region, tags, title, custom_title FROM games WHERE system = ? AND title = ? AND missing_since IS NULL AND id != ?", g.system, g.title, g.id)
      .map((v) => ({ id: v.id, region: v.region, tags: JSON.parse(v.tags || "[]"), title: v.custom_title || v.title }));
    const collections = db.all("SELECT c.id, c.name, EXISTS(SELECT 1 FROM collection_games cg WHERE cg.collection_id = c.id AND cg.game_id = ?) AS has FROM collections c WHERE c.profile_id = ? ORDER BY c.name", g.id, profile.id)
      .map((c) => ({ id: c.id, name: c.name, has: !!c.has }));
    const files = JSON.parse(g.files);
    json(res, 200, {
      ...gameRow(g, play),
      dbName: g.db_name, tags: JSON.parse(g.tags || "[]"), developer: g.developer, publisher: g.publisher,
      patch: (() => { const p = findPatch(library.absPath(g.path)); return p ? path.basename(p) : null; })(),
      description: g.description, descSource: g.desc_source, descUrl: g.desc_url, rating: g.rating,
      video: g.video_url ? `/api/games/${g.id}/video` : null, manual: g.manual_url ? `/api/games/${g.id}/manual` : null,
      infoChecked: !!g.info_checked,
      file: path.basename(g.path), folder: path.dirname(g.path), size: g.size, crc: g.crc, fileCount: files.length,
      playCount: play?.count || 0, states, save: save ? { size: save.size, updatedAt: save.updated_at } : null,
      variants, collections, system: g.system, systemInfo: publicSystem(BY_ID[g.system]),
    });
  });

  // ---- descriptions, videos, manuals ----
  r.get("/api/games/:id/video", async (req, res, { id }) => {
    const g = gameOr404(id);
    const file = await info.videoFile(g).catch(() => null);
    if (!file) throw new HttpError(404, "No video for this game.");
    sendFile(req, res, file, { type: "video/mp4", immutable: true });
  });
  r.get("/api/games/:id/manual", async (req, res, { id }) => {
    const g = gameOr404(id);
    if (!g.manual_url) throw new HttpError(404, "No manual for this game.");
    const up = await fetch(g.manual_url, { signal: AbortSignal.timeout(60000) }).catch(() => null);
    if (!up?.ok) throw new HttpError(502, "Couldn't fetch the manual.");
    res.writeHead(200, { "content-type": up.headers.get("content-type") || "application/pdf", "cache-control": "public, max-age=86400" });
    res.end(Buffer.from(await up.arrayBuffer()));
  });
  r.post("/api/games/:id/refetch-info", (req, res, { id }) => {
    const g = gameOr404(id);
    db.run("UPDATE games SET info_checked = 0 WHERE id = ?", g.id);
    info.enqueue(g.id);
    json(res, 202, { ok: true });
  });

  // ---- RetroAchievements (each player links their own account) ----
  r.get("/api/games/:id/achievements", async (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    try { json(res, 200, await achievements.forGame(profile.id, g)); }
    catch (e) { json(res, 200, { connected: true, error: e.message }); }
  });
  r.get("/api/retroachievements", (req, res) => {
    const a = achievements.account(profileOf(req).id);
    json(res, 200, a ? { user: a.user, avatar: a.avatar || null } : null);
  });
  r.put("/api/retroachievements", async (req, res) => {
    const profile = profileOf(req);
    const { user, key } = await readJson(req);
    if (!user || !key) throw new HttpError(400, "Enter your RetroAchievements username and Web API key.");
    let acct;
    try { acct = await achievements.verify(String(user).trim(), String(key).trim()); } catch (e) { throw new HttpError(e.status === 401 ? 400 : 502, e.message); }
    achievements.setAccount(profile.id, { user: acct.user, key: String(key).trim(), avatar: acct.avatar });
    json(res, 200, { user: acct.user, avatar: acct.avatar, points: acct.points });
  });
  r.delete("/api/retroachievements", (req, res) => { achievements.setAccount(profileOf(req).id, null); json(res, 200, { ok: true }); });

  // ---- ScreenScraper (descriptions, ratings, videos, manuals) ----
  r.get("/api/screenscraper", (req, res) => {
    const c = info.credentials();
    json(res, 200, { ready: info.screenscraperReady(), builtIn: !!process.env.PHOSPHOR_SS_DEVID, user: c.user || null, hasDev: !!(c.devid && c.devpassword) });
  });
  r.put("/api/screenscraper", async (req, res) => {
    const b = await readJson(req);
    const prev = db.getSetting("screenscraper", {}) || {};
    const next = { ...prev };
    for (const k of ["devid", "devpassword", "user", "password"]) if (k in b) next[k] = String(b[k] || "").trim();
    db.setSetting("screenscraper", next);
    // Check the login works before re-scanning everything.
    if (info.screenscraperReady()) {
      try {
        const r2 = await fetch(`${process.env.PHOSPHOR_SCREENSCRAPER_URL || "https://api.screenscraper.fr/api2"}/ssuserInfos.php?${info.ssParams()}`, { signal: AbortSignal.timeout(20000) });
        const t = await r2.text();
        if (!r2.ok || !t.trim().startsWith("{")) { db.setSetting("screenscraper", prev); throw new HttpError(400, `ScreenScraper said: ${t.slice(0, 140).trim() || r2.status}`); }
      } catch (e) { if (e instanceof HttpError) throw e; db.setSetting("screenscraper", prev); throw new HttpError(502, "Couldn't reach ScreenScraper."); }
      info.refetchAll();
    }
    json(res, 200, { ready: info.screenscraperReady() });
  });

  r.patch("/api/games/:id", async (req, res, { id }) => {
    const g = gameOr404(id);
    const b = await readJson(req);
    if ("title" in b) {
      const t = String(b.title || "").trim().slice(0, 120) || null;
      db.run("UPDATE games SET custom_title = ?, sort_title = ? WHERE id = ?", t, sortTitle(t || g.title), g.id);
    }
    json(res, 200, { ok: true });
  });

  r.post("/api/games/:id/favorite", async (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const b = await readJson(req);
    db.run("INSERT INTO plays(profile_id, game_id, favorite) VALUES(?,?,?) ON CONFLICT(profile_id, game_id) DO UPDATE SET favorite = excluded.favorite", profile.id, g.id, b.favorite ? 1 : 0);
    json(res, 200, { favorite: !!b.favorite });
  });

  r.post("/api/games/:id/refetch-art", (req, res, { id }) => {
    const g = gameOr404(id);
    db.run("UPDATE games SET art_checked = 0 WHERE id = ?", g.id);
    media.enqueue(g.id);
    json(res, 202, { ok: true });
  });

  r.put("/api/games/:id/art/:kind", async (req, res, { id, kind }) => {
    const g = gameOr404(id);
    if (!["box", "snap", "title"].includes(kind)) throw new HttpError(400, "Unknown art type.");
    const buf = await readBody(req, 12 * 1024 * 1024);
    const type = req.headers["content-type"] || "";
    const ext = type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "png";
    const name = await media.setCustom(g.id, kind, buf, ext);
    bus.emit("art", { id: g.id });
    json(res, 200, { url: artUrl(name) });
  });

  // ---- launching ----
  r.get("/api/games/:id/launch", async (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const sys = BY_ID[g.system];
    if (sys.native) {
      // Played in a desktop emulator: the play page asks the server to start it (desktop app only).
      const play = db.get("SELECT * FROM plays WHERE profile_id = ? AND game_id = ?", profile.id, g.id);
      return json(res, 200, {
        game: { ...gameRow(g, play), developer: g.developer, publisher: g.publisher },
        system: publicSystem(sys), profile: publicProfile(profile),
        native: { emulator: NATIVE[sys.native].name, desktop: !!runner, installed: !!native?.exePath(sys.native), local: isLocal(req), status: runner?.status() || null,
          supported: !native || native.supported(sys.native), needs: sys.needs && !(await biosReady())[sys.id] ? publicSystem(sys).needs : null },
      });
    }
    const active = emulators.active();
    if (!active) throw new HttpError(503, "No emulators are installed. Open Settings and press Update.");
    const files = JSON.parse(g.files);
    const main = files[0];
    const ext = path.extname(main).slice(1).toLowerCase();
    let gameUrl;
    const externalFiles = {};
    if (sys.arcade) {
      gameUrl = `/api/games/${g.id}/file/0/${encodeURIComponent(path.basename(main))}`;
    } else if (g.discs > 1) {
      gameUrl = `/api/games/${g.id}/m3u/${g.id}-${slug(g.title)}.m3u`;
      files.forEach((f, i) => { externalFiles[`/${path.basename(f)}`] = `/api/games/${g.id}/file/${i}/${encodeURIComponent(path.basename(f))}`; });
    } else {
      gameUrl = `/api/games/${g.id}/file/0/${g.id}-${slug(g.title)}.${ext}`;
      files.slice(1).forEach((f, i) => { externalFiles[`/${path.basename(f)}`] = `/api/games/${g.id}/file/${i + 1}/${encodeURIComponent(path.basename(f))}`; });
    }
    // BIOS files the user supplied go next to the game, where the emulator looks for them.
    const bios = await library.biosStatus();
    const needBios = sys.bios?.required ? bios[sys.id] : null;
    if (needBios && !needBios.ready) throw new HttpError(409, `${sys.short} games need a BIOS file. Drop ${sys.bios.files[0].name} into the BIOS folder.`);
    // Your own BIOS files (required or optional) go next to the game, where the emulator looks.
    const userBios = sys.bios ? bios[sys.id] : null;
    for (const f of userBios?.files || []) if (f.found) externalFiles[`/${f.name}`] = `/api/bios/file/${encodeURIComponent(path.basename(f.file))}`;
    // Free BIOS files that ship with Phosphor fill in for any the user doesn't have.
    // Only when the player has none of their own, so a real BIOS always wins.
    if (!userBios?.files?.some((f) => f.found)) {
      for (const b of sys.includedBios || []) externalFiles[`/${b.name}`] = `/bios-included/${encodeURIComponent(b.file)}`;
    }
    if (sys.arcade && bios.arcade.neogeo) externalFiles["/neogeo.zip"] = "/api/bios/file/neogeo.zip";

    // Soft-patching: a .ips/.bps/.ups named like the game (translations, romhacks) is applied on
    // load. The emulator matches patch to game by file name, so the URL names line up.
    const patch = !sys.arcade && !["zip", "7z"].includes(ext) && g.discs === 1 ? findPatch(library.absPath(main)) : null;
    const gamePatchUrl = patch ? `/api/games/${g.id}/patch/${path.basename(gameUrl).replace(/\.[^.]+$/, "")}${path.extname(patch)}` : null;

    // Per-game emulator choice: ?core= for a one-off try, or the one saved for this game.
    const coreChoice = db.getSetting(`core:${g.id}`, null);
    const wanted = new URL(req.url, "http://x").searchParams.get("core") || coreChoice;
    const core = wanted && sys.cores.includes(wanted) && emulators.hasCore(wanted) ? wanted : sys.core;
    const play = db.get("SELECT * FROM plays WHERE profile_id = ? AND game_id = ?", profile.id, g.id);
    const save = db.get("SELECT size, updated_at, hash FROM saves WHERE profile_id = ? AND game_id = ?", profile.id, g.id);
    const resume = db.get("SELECT created_at, core FROM states WHERE profile_id = ? AND game_id = ? AND slot = 0", profile.id, g.id);
    json(res, 200, {
      game: { ...gameRow(g, play), developer: g.developer, publisher: g.publisher },
      system: publicSystem(sys),
      core,
      cores: sys.cores.filter((c) => emulators.hasCore(c)),
      threads: !!sys.threads,
      emulatorPath: `/emulators/${encodeURIComponent(active.id)}/data/`,
      gameUrl, externalFiles, gamePatchUrl, patchName: patch ? path.basename(patch) : null,
      save: save ? { size: save.size, updatedAt: save.updated_at, hash: save.hash } : null,
      resume: resume ? { createdAt: resume.created_at, core: resume.core } : null,
      profile: publicProfile(profile),
      publicUrl: process.env.PHOSPHOR_PUBLIC_URL || null,
    });
  });

  r.get("/api/games/:id/patch/:name", (req, res, { id }) => {
    const g = gameOr404(id);
    const p = findPatch(library.absPath(JSON.parse(g.files)[0]));
    if (!p) throw new HttpError(404, "No patch for this game.");
    sendFile(req, res, p, { type: "application/octet-stream" });
  });

  // Remember which emulator works best for a game (applies to every player).
  r.put("/api/games/:id/core", async (req, res, { id }) => {
    const g = gameOr404(id);
    const { core } = await readJson(req);
    if (core && !BY_ID[g.system].cores.includes(core)) throw new HttpError(400, "That emulator doesn't run this console.");
    db.setSetting(`core:${g.id}`, core || null);
    json(res, 200, { core: core || BY_ID[g.system].core });
  });

  // Game files. The name in the URL is cosmetic (the emulator uses it as the file name).
  r.get("/api/games/:id/file/:n/:name", (req, res, { id, n }) => {
    const g = gameOr404(id);
    const files = JSON.parse(g.files);
    const rel = files[Number(n)];
    if (!rel) throw new HttpError(404, "No such file.");
    sendFile(req, res, library.absPath(rel), { type: "application/octet-stream" });
  });

  r.get("/api/games/:id/m3u/:name", (req, res, { id }) => {
    const g = gameOr404(id);
    const files = JSON.parse(g.files);
    const discs = files.filter((f) => /\.(cue|chd|pbp|iso|ccd|cso)$/i.test(f)).map((f) => path.basename(f));
    const body = discs.join("\n") + "\n";
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : body);
  });

  r.get("/api/games/:id/download", (req, res, { id }) => {
    const g = gameOr404(id);
    sendFile(req, res, library.absPath(g.path), { downloadName: path.basename(g.path) });
  });

  // ---- desktop emulators ----
  // Starts the game in its desktop emulator on this computer. Only from the computer itself: a
  // phone on the Wi-Fi shouldn't be able to pop a game up on someone's screen.
  r.post("/api/games/:id/native", async (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const sys = BY_ID[g.system];
    if (!sys.native) throw new HttpError(400, `${sys.short} games play right here in the browser.`);
    if (!runner) throw new HttpError(409, `${sys.short} games play in the Phosphor desktop app for Windows, Mac and Linux.`);
    if (!isLocal(req)) throw new HttpError(403, `Start ${sys.short} games on the computer running Phosphor.`);
    const emu = NATIVE[sys.native];
    if (!native.supported(sys.native)) throw new HttpError(409, `${sys.short} games aren't available on this computer yet: ${emu.name} only runs on Windows.`);
    const bios = await library.biosStatus();
    if (sys.needs && !bios[sys.id]?.ready) throw new HttpError(409, sys.needs.help);
    const files = JSON.parse(g.files);
    const safeProfile = profile.name.replace(/[^\w\- ]+/g, "").trim() || `Player ${profile.id}`;
    const dataDir = path.join(paths.internal, "native-data", sys.native, String(profile.id));
    let game = library.absPath(files.find((f) => /\.m3u$/i.test(f)) || files[0]);
    if (g.discs > 1 && !/\.m3u$/i.test(game)) {
      // Multi-disc games: a playlist of every disc lets the emulator swap discs itself.
      const discs = files.filter((f) => /\.(iso|gcm|rvz|gcz|wia|ciso|wbfs|gdi|cdi|chd|cue)$/i.test(f)).map((f) => library.absPath(f));
      fs.mkdirSync(dataDir, { recursive: true });
      game = path.join(dataDir, `game-${g.id}.m3u`);
      fs.writeFileSync(game, discs.join("\n") + "\n");
    }
    const now = Date.now();
    let out;
    try {
      out = await runner.start({
        emulatorId: sys.native, gameId: g.id, profileId: profile.id, game, dataDir, sysFiles: bios[sys.id]?.paths || null,
        graphics: desktopGraphics(profile),
        onStep: (message) => bus.emit("native", { running: false, preparing: true, gameId: g.id, message }),
        saveDir: path.join(library.savesDir, safeProfile, emu.saveFolder),
      });
    } catch (e) { throw new HttpError(e.status || 500, e.message); }
    db.run(`INSERT INTO plays(profile_id, game_id, last_played, count) VALUES(?,?,?,1)
      ON CONFLICT(profile_id, game_id) DO UPDATE SET last_played = excluded.last_played, count = count + 1`, profile.id, g.id, now);
    runner.current.session = Number(db.run("INSERT INTO sessions(profile_id, game_id, started_at, seconds) VALUES(?,?,?,0)", profile.id, g.id, now).lastInsertRowid);
    bus.emit("played", { id: g.id, profile: profile.id });
    bus.emit("native", runner.status());
    json(res, 200, out);
  });
  // Opens a desktop emulator's own settings window (controllers, graphics...) with this player's
  // settings folder, so whatever is changed there applies when Phosphor starts their games.
  r.post("/api/native/:emu/configure", async (req, res, { emu: emuId }) => {
    const profile = profileOf(req);
    const emu = NATIVE[emuId];
    if (!emu) throw new HttpError(404, "Unknown emulator.");
    if (!runner) throw new HttpError(409, "Only in the desktop app.");
    if (!isLocal(req)) throw new HttpError(403, "Open emulator settings on the computer running Phosphor.");
    const sysId = emu.systems[0];
    const bios = await library.biosStatus();
    const safeProfile = profile.name.replace(/[^\w\- ]+/g, "").trim() || `Player ${profile.id}`;
    try {
      const out = await runner.start({
        emulatorId: emuId, configure: true, profileId: profile.id, game: null, sysFiles: bios[sysId]?.paths || null, graphics: desktopGraphics(profile),
        saveDir: path.join(library.savesDir, safeProfile, emu.saveFolder),
        dataDir: path.join(paths.internal, "native-data", emuId, String(profile.id)),
      });
      bus.emit("native", runner.status());
      json(res, 200, out);
    } catch (e) { throw new HttpError(e.status || 500, e.message); }
  });
  r.get("/api/native", (req, res) => json(res, 200, { desktop: !!runner, status: runner?.status() || null, emulators: native?.summary() || [] }));
  r.post("/api/native/stop", (req, res) => {
    if (!runner || !isLocal(req)) throw new HttpError(403, "Not available here.");
    json(res, 200, { stopped: runner.stop() });
  });

  // ---- play sessions (play time, recently played) ----
  r.post("/api/games/:id/start", (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const now = Date.now();
    db.run(`INSERT INTO plays(profile_id, game_id, last_played, count) VALUES(?,?,?,1)
      ON CONFLICT(profile_id, game_id) DO UPDATE SET last_played = excluded.last_played, count = count + 1`, profile.id, g.id, now);
    const info = db.run("INSERT INTO sessions(profile_id, game_id, started_at, seconds) VALUES(?,?,?,0)", profile.id, g.id, now);
    bus.emit("played", { id: g.id, profile: profile.id });
    json(res, 200, { session: Number(info.lastInsertRowid) });
  });

  r.post("/api/sessions/:sid", async (req, res, { sid }) => {
    const b = await readJson(req);
    const s = db.get("SELECT * FROM sessions WHERE id = ?", Number(sid));
    if (!s) throw new HttpError(404, "No such session.");
    const seconds = Math.max(0, Math.min(Number(b.seconds) || 0, 24 * 3600));
    const delta = Math.max(0, seconds - s.seconds);
    db.run("UPDATE sessions SET seconds = ? WHERE id = ?", seconds, s.id);
    db.run("UPDATE plays SET seconds = seconds + ?, last_played = ? WHERE profile_id = ? AND game_id = ?", delta, Date.now(), s.profile_id, s.game_id);
    json(res, 200, { ok: true });
  });

  // ---- in-game saves (battery saves / memory cards), synced across devices ----
  const saveFileFor = (profile, g, ext) => {
    const sys = BY_ID[g.system];
    const safeProfile = profile.name.replace(/[^\w\- ]+/g, "").trim() || `Player ${profile.id}`;
    const stem = path.basename(g.path, path.extname(g.path));
    return path.join(library.savesDir, safeProfile, sys.folder, `${stem}.${ext.replace(/[^a-z0-9]/gi, "") || "srm"}`);
  };

  r.get("/api/games/:id/save", (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const row = db.get("SELECT * FROM saves WHERE profile_id = ? AND game_id = ?", profile.id, g.id);
    if (!row || !fs.existsSync(row.file)) throw new HttpError(404, "No save yet.");
    sendFile(req, res, row.file, { type: "application/octet-stream", headers: { "x-updated-at": String(row.updated_at), "x-hash": row.hash } });
  });

  r.put("/api/games/:id/save", async (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const buf = await readBody(req, 64 * 1024 * 1024);
    if (!buf.length) throw new HttpError(400, "Empty save.");
    const ext = new URL(req.url, "http://x").searchParams.get("ext") || "srm";
    const hash = crypto.createHash("sha1").update(buf).digest("hex");
    const prev = db.get("SELECT * FROM saves WHERE profile_id = ? AND game_id = ?", profile.id, g.id);
    if (prev && prev.hash === hash) return json(res, 200, { unchanged: true, updatedAt: prev.updated_at });
    const file = prev?.file && fs.existsSync(prev.file) ? prev.file : saveFileFor(profile, g, ext);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    // Keep the last few versions of every save so a bad overwrite can be undone.
    if (fs.existsSync(file)) {
      const hist = path.join(path.dirname(file), ".history");
      await fsp.mkdir(hist, { recursive: true });
      await fsp.copyFile(file, path.join(hist, `${path.basename(file)}.${prev?.updated_at || Date.now()}`));
      const old = (await fsp.readdir(hist)).filter((f) => f.startsWith(path.basename(file) + ".")).sort().reverse();
      for (const f of old.slice(SAVE_HISTORY)) await fsp.unlink(path.join(hist, f)).catch(() => {});
    }
    const tmp = `${file}.tmp-${process.pid}`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, file);
    const now = Date.now();
    db.run(`INSERT INTO saves(profile_id, game_id, file, size, hash, updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(profile_id, game_id) DO UPDATE SET file = excluded.file, size = excluded.size, hash = excluded.hash, updated_at = excluded.updated_at`,
    profile.id, g.id, file, buf.length, hash, now);
    json(res, 200, { updatedAt: now, hash });
  });

  r.get("/api/games/:id/save/history", (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const row = db.get("SELECT * FROM saves WHERE profile_id = ? AND game_id = ?", profile.id, g.id);
    if (!row) return json(res, 200, []);
    const hist = path.join(path.dirname(row.file), ".history");
    let list = [];
    try { list = fs.readdirSync(hist).filter((f) => f.startsWith(path.basename(row.file) + ".")); } catch { /* none */ }
    json(res, 200, list.map((f) => ({ at: Number(f.split(".").pop()), size: fs.statSync(path.join(hist, f)).size })).sort((a, b) => b.at - a.at));
  });

  r.post("/api/games/:id/save/restore", async (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const { at } = await readJson(req);
    const row = db.get("SELECT * FROM saves WHERE profile_id = ? AND game_id = ?", profile.id, g.id);
    if (!row) throw new HttpError(404, "No save to restore.");
    const src = path.join(path.dirname(row.file), ".history", `${path.basename(row.file)}.${Number(at)}`);
    if (!fs.existsSync(src)) throw new HttpError(404, "That version is gone.");
    const buf = await fsp.readFile(src);
    await fsp.copyFile(row.file, path.join(path.dirname(row.file), ".history", `${path.basename(row.file)}.${row.updated_at}`)).catch(() => {});
    await fsp.writeFile(row.file, buf);
    const now = Date.now();
    db.run("UPDATE saves SET size = ?, hash = ?, updated_at = ? WHERE profile_id = ? AND game_id = ?", buf.length, crypto.createHash("sha1").update(buf).digest("hex"), now, profile.id, g.id);
    json(res, 200, { updatedAt: now });
  });

  // ---- save states (slot 0 is the automatic "resume where I left off" state) ----
  r.get("/api/games/:id/states", (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    json(res, 200, db.all("SELECT slot, size, created_at, core FROM states WHERE profile_id = ? AND game_id = ? ORDER BY slot", profile.id, g.id)
      .map((s) => ({ slot: s.slot, size: s.size, createdAt: s.created_at, core: s.core, thumb: `/api/games/${g.id}/states/${s.slot}/thumb?profile=${profile.id}&t=${s.created_at}` })));
  });

  r.get("/api/games/:id/states/:slot", (req, res, { id, slot }) => {
    const profile = profileOf(req);
    const file = path.join(statesDir(profile.id, Number(id)), `${Number(slot)}.state`);
    sendFile(req, res, file, { type: "application/octet-stream" });
  });

  r.get("/api/games/:id/states/:slot/thumb", (req, res, { id, slot }) => {
    const profile = profileOf(req);
    const file = path.join(statesDir(profile.id, Number(id)), `${Number(slot)}.png`);
    sendFile(req, res, file, { type: "image/png", immutable: true });
  });

  r.put("/api/games/:id/states/:slot", async (req, res, { id, slot }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const s = Number(slot);
    if (!(s >= 0 && s <= 99)) throw new HttpError(400, "Bad slot.");
    const buf = await readBody(req, 256 * 1024 * 1024);
    if (!buf.length) throw new HttpError(400, "Empty state.");
    const dir = statesDir(profile.id, g.id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, `${s}.state.tmp`), buf);
    await fsp.rename(path.join(dir, `${s}.state.tmp`), path.join(dir, `${s}.state`));
    const now = Date.now();
    db.run(`INSERT INTO states(profile_id, game_id, slot, core, size, created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(profile_id, game_id, slot) DO UPDATE SET core = excluded.core, size = excluded.size, created_at = excluded.created_at`,
    profile.id, g.id, s, String(req.headers["x-core"] || BY_ID[g.system].core), buf.length, now);
    json(res, 200, { slot: s, createdAt: now });
  });

  r.put("/api/games/:id/states/:slot/thumb", async (req, res, { id, slot }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const buf = await readBody(req, 8 * 1024 * 1024);
    const dir = statesDir(profile.id, g.id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, `${Number(slot)}.png`), buf);
    json(res, 200, { ok: true });
  });

  r.delete("/api/games/:id/states/:slot", async (req, res, { id, slot }) => {
    const profile = profileOf(req);
    const dir = statesDir(profile.id, Number(id));
    for (const ext of ["state", "png"]) await fsp.unlink(path.join(dir, `${Number(slot)}.${ext}`)).catch(() => {});
    db.run("DELETE FROM states WHERE profile_id = ? AND game_id = ? AND slot = ?", profile.id, Number(id), Number(slot));
    json(res, 200, { ok: true });
  });

  // ---- screenshots: real PNG files in Screenshots/<player>/<console>/ ----
  const shotDir = (profile, g) => path.join(library.shotsDir, profile.name.replace(/[^\w\- ]+/g, "").trim() || `Player ${profile.id}`, BY_ID[g.system].folder);
  const shotPrefix = (g) => (g.custom_title || g.title).replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || `game-${g.id}`;
  r.put("/api/games/:id/screenshots", async (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const buf = await readBody(req, 16 * 1024 * 1024);
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new HttpError(400, "Screenshots must be PNG images.");
    const dir = shotDir(profile, g);
    await fsp.mkdir(dir, { recursive: true });
    const name = `${shotPrefix(g)} ${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}.png`;
    await fsp.writeFile(path.join(dir, name), buf);
    json(res, 201, { name });
  });
  // Video clips recorded in-game land next to the screenshots.
  r.put("/api/games/:id/clips", async (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const type = String(req.headers["content-type"] || "");
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const dir = shotDir(profile, g);
    await fsp.mkdir(dir, { recursive: true });
    const name = `${shotPrefix(g)} ${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}.${ext}`;
    const tmp = path.join(dir, `.${name}.part`);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      let size = 0;
      req.on("data", (c) => { size += c.length; if (size > 512 * 1024 * 1024) req.destroy(new Error("Clip too big")); });
      req.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      req.on("error", reject);
    }).catch(async (e) => { await fsp.unlink(tmp).catch(() => {}); throw new HttpError(400, e.message); });
    await fsp.rename(tmp, path.join(dir, name));
    json(res, 201, { name });
  });
  r.get("/api/games/:id/screenshots", (req, res, { id }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const dir = shotDir(profile, g);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.startsWith(`${shotPrefix(g)} `) && /\.(png|webm|mp4)$/.test(f)); } catch { /* none yet */ }
    json(res, 200, files.sort().reverse().map((f) => ({ name: f, kind: f.endsWith(".png") ? "image" : "video", url: `/api/games/${g.id}/screenshots/${encodeURIComponent(f)}?profile=${profile.id}`, at: fs.statSync(path.join(dir, f)).mtimeMs })));
  });
  r.get("/api/games/:id/screenshots/:name", (req, res, { id, name }) => {
    const profile = profileOf(req);
    const g = gameOr404(id);
    const n = path.basename(name);
    sendFile(req, res, path.join(shotDir(profile, g), n), { type: n.endsWith(".png") ? "image/png" : n.endsWith(".mp4") ? "video/mp4" : "video/webm", immutable: true });
  });

  // ---- collections ----
  r.get("/api/collections", (req, res) => {
    const profile = profileOf(req);
    json(res, 200, db.all(`SELECT c.id, c.name, COUNT(cg.game_id) n FROM collections c LEFT JOIN collection_games cg ON cg.collection_id = c.id
      WHERE c.profile_id = ? GROUP BY c.id ORDER BY c.name`, profile.id).map((c) => {
      const covers = db.all(`SELECT g.art_box FROM collection_games cg JOIN games g ON g.id = cg.game_id WHERE cg.collection_id = ? AND g.art_box IS NOT NULL ORDER BY cg.added_at DESC LIMIT 4`, c.id).map((x) => artUrl(x.art_box));
      return { id: c.id, name: c.name, count: c.n, covers };
    }));
  });
  r.post("/api/collections", async (req, res) => {
    const profile = profileOf(req);
    const b = await readJson(req);
    const name = String(b.name || "").trim().slice(0, 40);
    if (!name) throw new HttpError(400, "Give the collection a name.");
    const info = db.run("INSERT INTO collections(profile_id, name, created_at) VALUES(?,?,?)", profile.id, name, Date.now());
    const cid = Number(info.lastInsertRowid);
    if (b.gameId) db.run("INSERT OR IGNORE INTO collection_games(collection_id, game_id, added_at) VALUES(?,?,?)", cid, Number(b.gameId), Date.now());
    json(res, 201, { id: cid, name });
  });
  r.patch("/api/collections/:cid", async (req, res, { cid }) => {
    const b = await readJson(req);
    if (b.name) db.run("UPDATE collections SET name = ? WHERE id = ?", String(b.name).trim().slice(0, 40), Number(cid));
    json(res, 200, { ok: true });
  });
  r.delete("/api/collections/:cid", (req, res, { cid }) => {
    db.run("DELETE FROM collection_games WHERE collection_id = ?", Number(cid));
    db.run("DELETE FROM collections WHERE id = ?", Number(cid));
    json(res, 200, { ok: true });
  });
  r.post("/api/collections/:cid/games", async (req, res, { cid }) => {
    const b = await readJson(req);
    if (b.remove) db.run("DELETE FROM collection_games WHERE collection_id = ? AND game_id = ?", Number(cid), Number(b.gameId));
    else db.run("INSERT OR IGNORE INTO collection_games(collection_id, game_id, added_at) VALUES(?,?,?)", Number(cid), Number(b.gameId), Date.now());
    json(res, 200, { ok: true });
  });

  // ---- stats ----
  r.get("/api/stats", (req, res) => {
    const profile = profileOf(req);
    const days = db.all(`SELECT CAST((started_at / 86400000) AS INTEGER) d, SUM(seconds) s FROM sessions WHERE profile_id = ? AND started_at > ? GROUP BY d ORDER BY d`, profile.id, Date.now() - 30 * 86400e3);
    const bySystem = db.all(`SELECT g.system, SUM(p.seconds) s FROM plays p JOIN games g ON g.id = p.game_id WHERE p.profile_id = ? GROUP BY g.system ORDER BY s DESC`, profile.id);
    const top = db.all(`SELECT g.*, p.seconds, p.count, p.last_played, p.favorite FROM plays p JOIN games g ON g.id = p.game_id WHERE p.profile_id = ? AND p.seconds > 0 ORDER BY p.seconds DESC LIMIT 10`, profile.id)
      .map((g) => ({ ...gameRow(g, g), count: g.count }));
    const total = db.get("SELECT IFNULL(SUM(seconds),0) s, COUNT(*) n FROM plays WHERE profile_id = ? AND count > 0", profile.id);
    // Day streak: consecutive days (ending today or yesterday) with any play.
    const daySet = new Set(db.all("SELECT DISTINCT CAST((started_at / 86400000) AS INTEGER) d FROM sessions WHERE profile_id = ? AND seconds > 30", profile.id).map((x) => x.d));
    let streak = 0;
    let d = Math.floor(Date.now() / 86400000);
    if (!daySet.has(d)) d--;
    while (daySet.has(d)) { streak++; d--; }
    json(res, 200, { days, bySystem, top, totalSeconds: total.s, gamesPlayed: total.n, streak });
  });

  // ---- library management ----
  r.post("/api/library/scan", (req, res) => {
    const q = new URL(req.url, "http://x").searchParams;
    const full = q.get("full") === "1";
    const scan = library.scan({ reason: full ? "re-check everything" : q.get("wait") ? "added files" : "manual", full });
    // ?wait=1: answer when it's done, with what it found (used after adding games).
    if (q.get("wait")) return scan.then((r) => json(res, 200, { ok: true, added: r?.added ?? 0, sorted: r?.sorted ?? 0, unknown: library.status.unknown || [] }));
    json(res, 202, { ok: true });
  });
  r.get("/api/library/status", (req, res) => json(res, 200, library.status));

  // Upload progress as the server sees it: bytes actually written to disk. (A browser reports a
  // file as "sent" once it has read it, which for a big file on this computer is long before it's
  // saved, so its own progress jumps to 100% and then sits there.)
  const uploads = new Map(); // id -> { written, total, at }
  r.get("/api/upload/progress", (req, res) => {
    const id = new URL(req.url, "http://x").searchParams.get("id");
    const u = uploads.get(id);
    json(res, 200, u ? { written: u.written, total: u.total, done: !!u.done } : { written: 0, total: 0, done: false });
  });
  r.put("/api/upload", async (req, res) => {
    const q = new URL(req.url, "http://x").searchParams;
    const id = String(q.get("id") || "").slice(0, 64);
    const track = id ? { written: 0, total: Number(req.headers["content-length"]) || 0, at: Date.now() } : null;
    if (track) {
      uploads.set(id, track);
      req.on("data", (c) => { track.written += c.length; });
    }
    const forget = () => { if (track) { track.done = true; setTimeout(() => uploads.delete(id), 60000); } };
    req.on("close", forget);
    const rel = String(q.get("path") || q.get("name") || "").replace(/\\/g, "/");
    const parts = rel.split("/").filter((p) => p && p !== "." && p !== ".." && !p.startsWith("."));
    if (!parts.length) throw new HttpError(400, "Missing file name.");
    const dest = path.join(library.dropDir, ...parts);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = path.join(library.dropDir, `.upload-${crypto.randomBytes(6).toString("hex")}`);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      req.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      req.on("error", reject);
      req.on("aborted", () => reject(new HttpError(400, "Upload cancelled.")));
    }).catch(async (e) => { await fsp.unlink(tmp).catch(() => {}); throw e; });
    await fsp.rename(tmp, dest);
    json(res, 201, { ok: true, name: parts.join("/") });
  });

  r.get("/api/bios", async (req, res) => json(res, 200, await library.biosStatus()));
  r.get("/api/bios/file/:name", (req, res, { name }) => {
    const file = path.join(library.biosDir, path.basename(name));
    if (fs.existsSync(file)) return sendFile(req, res, file, { type: "application/octet-stream" });
    // Name matched by checksum may live in a subfolder.
    library.biosStatus().then((st) => {
      const hit = Object.values(st).flatMap((s) => s.files).find((f) => f.file && path.basename(f.file) === path.basename(name));
      if (hit) sendFile(req, res, hit.file, { type: "application/octet-stream" });
      else json(res, 404, { error: "BIOS file not found." });
    });
  });

  // ---- free homebrew games ----
  r.get("/api/free-games", (req, res) => json(res, 200, freeGames.list()));
  r.post("/api/free-games/:fid/install", async (req, res, { fid }) => {
    try {
      const out = fid === "all"
        ? { results: await Promise.all(freeGames.list().filter((g) => !g.installed).map((g) => freeGames.install(g.id).catch((e) => ({ error: e.message, id: g.id })))) }
        : await freeGames.install(fid);
      library.scan({ reason: "free games" });
      json(res, 200, out);
    } catch (e) { throw new HttpError(502, `Couldn't download it: ${e.message}`); }
  });

  // ---- emulators (the one-button updater) ----
  r.get("/api/emulators", (req, res) => json(res, 200, emulators.summary()));
  r.post("/api/emulators/check", async (req, res) => {
    try { json(res, 200, await emulators.check()); } catch (e) { throw new HttpError(502, e.message); }
  });
  // Body { kind, id } updates or rolls back just that emulator; no body means all of them.
  const emulatorItem = async (req) => {
    const b = await readJson(req).catch(() => ({}));
    return b?.kind ? { kind: String(b.kind), id: String(b.id || "") } : null;
  };
  r.post("/api/emulators/update", async (req, res) => {
    if (emulators.state.running) throw new HttpError(409, "An update is already running.");
    const only = await emulatorItem(req);
    emulators.update({ only }).catch(() => {});
    json(res, 202, { started: true });
  });
  r.post("/api/emulators/check-one", async (req, res) => {
    const item = await emulatorItem(req);
    if (!item) throw new HttpError(400, "Which emulator?");
    try { json(res, 200, await emulators.checkOne(item)); } catch (e) { throw new HttpError(502, e.message); }
  });
  r.post("/api/emulators/rollback", async (req, res) => {
    const only = await emulatorItem(req);
    try { json(res, 200, only ? await emulators.rollbackOne(only) : await emulators.rollback()); } catch (e) { throw new HttpError(400, e.message); }
  });

  // ---- live events (server-sent events) ----
  r.get("/api/events", (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(`retry: 3000\n\n`);
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const handlers = {};
    for (const ev of ["library", "emulators", "game", "art", "played", "upload", "info", "native"]) {
      handlers[ev] = (d) => send(ev, d);
      bus.on(ev, handlers[ev]);
    }
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      for (const [ev, h] of Object.entries(handlers)) bus.off(ev, h);
    });
  });

  return r;
}

// Settings › Graphics for desktop emulators (per player). null = leave each emulator's own settings.
export const GRAPHICS_DEFAULTS = { scale: 2, widescreen: false, fps: false, vsync: true };
const desktopGraphics = (profile) => {
  const g = JSON.parse(profile.settings || "{}").graphics;
  if (g?.mode === "emulator") return null;
  return { ...GRAPHICS_DEFAULTS, ...(g || {}), scale: Math.max(1, Math.min(6, Number(g?.scale) || GRAPHICS_DEFAULTS.scale)) };
};

const isLocal = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

const PATCH_EXTS = [".ips", ".bps", ".ups"];
// A patch file sitting next to a game with the same name ("Game.sfc" + "Game.ips").
export function findPatch(romPath) {
  const stem = romPath.slice(0, romPath.length - path.extname(romPath).length);
  for (const ext of PATCH_EXTS) for (const e of [ext, ext.toUpperCase()]) if (fs.existsSync(stem + e)) return stem + e;
  return null;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function ensureDefaultProfile(db) {
  if (!db.get("SELECT id FROM profiles LIMIT 1")) {
    db.run("INSERT INTO profiles(name, color, avatar, created_at) VALUES(?,?,?,?)", "Player 1", COLORS[0], AVATARS[0], Date.now());
  }
}

export { parseName };
