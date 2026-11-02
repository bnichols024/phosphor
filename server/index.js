// Phosphor server entry point.
import http from "node:http";
import https from "node:https";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { GameDB } from "./gamedb.js";
import { Library, IDENTIFY_VERSION } from "./library.js";
import { Media } from "./media.js";
import { Emulators } from "./emulators.js";
import { buildApi, ensureDefaultProfile } from "./api.js";
import { HttpError, json, sendFile, safeJoin } from "./http.js";
import { BY_ID } from "./systems.js";
import { attachPads } from "./pad.js";
import { FreeGames } from "./freegames.js";
import { GameInfo } from "./info.js";
import { Achievements } from "./achievements.js";
import { NativeEmulators } from "./native/manager.js";
import { NativeRunner } from "./native/runner.js";

export const APP_NAME = "Phosphor";
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));

const ts = () => new Date().toISOString().slice(11, 19);
const log = {
  info: (...a) => console.log(ts(), ...a),
  warn: (...a) => console.warn(ts(), "WARN", ...a),
  error: (...a) => console.error(ts(), "ERROR", ...a),
};

export async function start(opts = {}) {
  const root = path.resolve(opts.root || process.env.PHOSPHOR_ROOT || path.join(appDir, "library"));
  const port = Number(opts.port ?? process.env.PORT ?? 8080);
  const internal = path.join(root, ".phosphor");
  fs.mkdirSync(internal, { recursive: true });
  const paths = { root, internal, web: path.join(appDir, "web") };

  const db = openDb(path.join(internal, "phosphor.db"));
  ensureDefaultProfile(db);
  const gamedb = new GameDB(opts.dbDir || path.join(appDir, "db"));
  const bus = new EventEmitter();
  bus.setMaxListeners(200);
  const library = new Library({ root, db, gamedb, log });
  const media = new Media({ dir: path.join(internal, "media"), db, log });
  // Desktop emulators (Dreamcast, GameCube, Wii...) only exist in the desktop app, which passes
  // `native`: where the bundled ones are and a local folder for updates.
  const native = opts.native ? new NativeEmulators({
    bundledDir: opts.native.bundledDir || path.join(appDir, "vendor", "native"),
    userDir: opts.native.userDir || path.join(internal, "native"),
    platform: opts.native.platform,
    log,
  }) : null;
  const emulators = new Emulators({
    bundledDir: opts.bundledEmulators || process.env.PHOSPHOR_BUNDLED_EMULATORS || path.join(appDir, "vendor", "emulators"),
    userDir: path.join(internal, "emulators"),
    native,
    log,
  });
  const runner = native ? new NativeRunner({
    native, log, spawnFn: opts.native.spawn, quickExit: opts.native.quickExit,
    onStart: (e) => opts.native.onStart?.(e),
    onExit: (e) => {
      // Play time for the session the API opened when the game started.
      const sid = e.session;
      const s = sid && db.get("SELECT * FROM sessions WHERE id = ?", sid);
      if (s && !e.failed) {
        db.run("UPDATE sessions SET seconds = ? WHERE id = ?", e.seconds, s.id);
        db.run("UPDATE plays SET seconds = seconds + ?, last_played = ? WHERE profile_id = ? AND game_id = ?", e.seconds, Date.now(), s.profile_id, s.game_id);
      }
      bus.emit("native", { running: false, last: e });
      opts.native.onExit?.(e);
    },
  }) : null;

  await library.ensureLayout();
  library.on("progress", (s) => bus.emit("library", s));
  library.on("game", (g) => { bus.emit("game", g); media.enqueue(g.id); });
  library.on("changed", () => media.enqueueMissing());
  media.onArt = (id) => bus.emit("art", { id });
  emulators.onProgress((s) => bus.emit("emulators", s));

  const freeGames = new FreeGames({ library, db, log });
  const info = new GameInfo({ db, library, dir: path.join(internal, "media"), log });
  const achievements = new Achievements({ db, library, dir: path.join(internal, "cache"), log });
  library.on("game", (g) => info.enqueue(g.id));
  library.on("changed", () => info.enqueueMissing());
  info.onInfo = (id) => bus.emit("info", { id });
  const api = buildApi({ db, library, media, emulators, bus, paths, version: pkg.version, freeGames, info, achievements, native, runner });

  const handler = async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    try {
      if (p.startsWith("/api/")) {
        const m = api.match(req.method, p);
        if (!m) throw new HttpError(404, "Not found.");
        return await m.handler(req, res, m.params);
      }
      if (p.startsWith("/emulators/")) {
        const [, , id, ...rest] = p.split("/");
        const install = emulators.listInstalls().find((i) => i.id === decodeURIComponent(id));
        const file = install && safeJoin(install.dir, decodeURIComponent(rest.join("/")));
        if (!file) throw new HttpError(404, "Not found.");
        return sendFile(req, res, file, { immutable: true, headers: { "cross-origin-resource-policy": "same-origin" } });
      }
      if (p.startsWith("/bios-included/")) {
        const file = safeJoin(path.join(appDir, "bios"), decodeURIComponent(p.slice(15)));
        if (!file || !file.endsWith(".bin")) throw new HttpError(404, "Not found.");
        return sendFile(req, res, file, { type: "application/octet-stream" });
      }
      if (p.startsWith("/media/")) {
        const file = media.file(decodeURIComponent(p.slice(7)));
        if (!file) throw new HttpError(404, "Not found.");
        return sendFile(req, res, file, { immutable: true });
      }
      if (/^\/play\/\d+\/?$/.test(p)) {
        // Threaded emulators (PSP, DOS) need SharedArrayBuffer, which needs cross-origin isolation.
        const g = db.get("SELECT system FROM games WHERE id = ?", Number(p.split("/")[2]));
        const isolate = g && BY_ID[g.system]?.threads;
        return sendFile(req, res, path.join(paths.web, "play.html"), {
          headers: isolate ? { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" } : {},
        });
      }
      if (p === "/pad" || p === "/pad/") return sendFile(req, res, path.join(paths.web, "pad.html"));
      if (p === "/sw.js") return sendFile(req, res, path.join(paths.web, "sw.js"), { headers: { "service-worker-allowed": "/" } });
      const file = p !== "/" && safeJoin(paths.web, decodeURIComponent(p));
      if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return sendFile(req, res, file, { immutable: /\/vendor\/|\/fonts\//.test(p) });
      }
      if (path.extname(p)) throw new HttpError(404, "Not found.");
      return sendFile(req, res, path.join(paths.web, "index.html"));
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      const status = e.status || 500;
      if (status >= 500) log.error(req.method, p, e.stack || e.message);
      json(res, status, { error: e.message || "Something went wrong." });
    }
  };
  const server = http.createServer(handler);
  attachPads(server, { log });

  await new Promise((resolve, reject) => {
    // A port that's taken must be a normal error the caller can handle, not a crash.
    server.once("error", (e) => { db.close(); reject(e.code === "EADDRINUSE" ? new Error(`Port ${port} is already in use by another program.`) : e); });
    server.listen(port, opts.host || "0.0.0.0", resolve);
  });
  const actualPort = server.address().port;
  log.info(`${APP_NAME} ${pkg.version} on http://localhost:${actualPort} — library at ${root}`);

  // Optional HTTPS: PSP and DOS emulators need a secure page (SharedArrayBuffer), and so do some
  // browser features. Uses your certificate if you provide one, otherwise a self-signed one.
  let secure = null;
  const httpsPort = Number(opts.httpsPort ?? process.env.PHOSPHOR_HTTPS_PORT ?? 0);
  if (httpsPort) {
    const tls = loadTls(internal);
    if (tls) {
      secure = https.createServer(tls, handler);
      attachPads(secure, { log });
      await new Promise((resolve) => secure.listen(httpsPort, opts.host || "0.0.0.0", resolve));
      log.info(`HTTPS on port ${httpsPort}${tls.selfSigned ? " (self-signed certificate)" : ""}`);
    }
  }
  if (!emulators.active()) log.warn("no emulators installed yet: open Settings > Emulators > Update");

  if (opts.scan !== false) {
    const full = (db.getSetting("identifyVersion", 0) || 0) < IDENTIFY_VERSION;
    library.scan({ reason: full ? "startup (re-checking every game)" : "startup", full }).then(() => {
      db.setSetting("identifyVersion", IDENTIFY_VERSION);
      if (opts.watch !== false) library.watch();
    });
  }
  return { server, port: actualPort, db, library, media, emulators, native, runner, bus, close: () => new Promise((r) => { secure?.close(); server.close(r); server.closeAllConnections?.(); db.close(); }) };
}

// Certificate from PHOSPHOR_TLS_CERT/KEY, or <library>/.phosphor/tls/, generated with openssl if missing.
function loadTls(internal) {
  const cert = process.env.PHOSPHOR_TLS_CERT || path.join(internal, "tls", "cert.pem");
  const key = process.env.PHOSPHOR_TLS_KEY || path.join(internal, "tls", "key.pem");
  let selfSigned = false;
  if (!fs.existsSync(cert) || !fs.existsSync(key)) {
    if (process.env.PHOSPHOR_TLS_CERT) { log.warn(`TLS certificate ${cert} not found; HTTPS disabled`); return null; }
    fs.mkdirSync(path.dirname(cert), { recursive: true });
    const san = ["DNS:localhost", "DNS:phosphor", "IP:127.0.0.1", ...lanAddresses().map((a) => `IP:${a}`)].join(",");
    const r = spawnSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "3650",
      "-subj", "/CN=Phosphor", "-addext", `subjectAltName=${san}`, "-keyout", key, "-out", cert], { stdio: "ignore" });
    if (r.status !== 0) { log.warn("couldn't create a self-signed certificate (openssl missing?); HTTPS disabled"); return null; }
    selfSigned = true;
  }
  try { return { cert: fs.readFileSync(cert), key: fs.readFileSync(key), selfSigned }; } catch (e) { log.warn(`TLS: ${e.message}`); return null; }
}

export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((e) => { log.error(e.stack || e.message); process.exit(1); });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
}
