// Installs, updates and rolls back the desktop emulators. Same idea as the browser emulators
// (server/emulators.js): every version lives in its own folder, a small active.json says which one
// runs, the previous one is kept for undo, and nothing changes until a new version is unpacked and
// checked. The set bundled with the app is read-only; updates go to a writable folder next to it.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NATIVE, NATIVE_IDS, latestRelease } from "./catalog.js";

const require = createRequire(import.meta.url);

export class NativeEmulators {
  constructor({ bundledDir, userDir, platform = process.platform, log = console }) {
    this.bundledDir = bundledDir;
    this.userDir = userDir;
    this.platform = platform;
    this.log = log;
  }

  supported(id) { return !!NATIVE[id]?.sources[this.platform]; }

  _readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }

  installs(id) {
    const out = [];
    for (const [root, source] of [[this.userDir, "update"], [this.bundledDir, "bundled"]]) {
      const dir = root && path.join(root, id);
      if (!dir || !fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        const m = this._readJson(path.join(dir, name, "manifest.json"));
        if (m && m.platform === this.platform) out.push({ ...m, source, dir: path.join(dir, name) });
      }
    }
    return out.sort((a, b) => (b.installedAt || "").localeCompare(a.installedAt || ""));
  }

  active(id) {
    const all = this.installs(id);
    for (const [root, source] of [[this.userDir, "update"], [this.bundledDir, "bundled"]]) {
      const p = root && this._readJson(path.join(root, id, "active.json"));
      const hit = p && all.find((i) => i.source === source && i.version === p.version);
      if (hit && fs.existsSync(path.join(hit.dir, hit.exe))) return hit;
    }
    return all.find((i) => fs.existsSync(path.join(i.dir, i.exe))) || null;
  }

  exePath(id) { const a = this.active(id); return a ? path.join(a.dir, a.exe) : null; }

  summary() {
    return NATIVE_IDS.filter((id) => this.supported(id)).map((id) => {
      const a = this.active(id);
      const prev = this.installs(id).find((i) => a && i.version !== a.version);
      return { id, name: NATIVE[id].name, systems: NATIVE[id].systems, home: NATIVE[id].home, version: a?.version || null, source: a?.source || null, installedAt: a?.installedAt || null, previous: prev?.version || null,
        configurable: !!NATIVE[id].configure, graphics: NATIVE[id].graphics || [] };
    });
  }

  async check() {
    const out = [];
    // One emulator's site being down doesn't stop the others from updating.
    await Promise.all(NATIVE_IDS.filter((x) => this.supported(x)).map(async (id) => {
      const have = this.active(id)?.version || null;
      try {
        const rel = await latestRelease(NATIVE[id], this.platform);
        out.push({ id, name: NATIVE[id].name, from: have, to: rel.version, release: rel, changed: have !== rel.version });
      } catch (e) {
        this.log.warn?.(`native: ${NATIVE[id].name}: ${e.message}`);
        out.push({ id, name: NATIVE[id].name, from: have, to: have, error: e.message, changed: false });
      }
    }));
    return NATIVE_IDS.map((id) => out.find((o) => o.id === id)).filter(Boolean);
  }

  // Download + unpack one emulator into `root` (default: the update folder) and make it active.
  async install(id, rel, { root = this.userDir, onProgress = () => {} } = {}) {
    const emu = NATIVE[id];
    const base = path.join(root, id);
    const final = path.join(base, rel.version);
    const staging = path.join(base, `.staging-${rel.version}-${Date.now()}`);
    await fsp.mkdir(staging, { recursive: true });
    try {
      const archive = path.join(staging, `.download-${rel.file}`);
      onProgress(`Downloading ${emu.name} ${rel.version}`);
      await downloadToFile(rel.url, archive);
      onProgress(`Unpacking ${emu.name}`);
      await extract(archive, staging, rel.file);
      await fsp.rm(archive, { force: true });
      const exe = findExe(staging, emu.exe[this.platform]);
      if (!exe) throw new Error(`${emu.name} download didn't contain the program.`);
      if (this.platform !== "win32" && !exe.endsWith(".app")) await fsp.chmod(path.join(staging, exe), 0o755).catch(() => {});
      const manifest = { emulator: id, version: rel.version, platform: this.platform, exe, file: rel.file, installedAt: new Date().toISOString() };
      await fsp.writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
      await fsp.rm(final, { recursive: true, force: true });
      await fsp.rename(staging, final);
      await fsp.writeFile(path.join(base, "active.json"), JSON.stringify({ version: rel.version }));
      if (root === this.userDir) await this._prune(id);
      this.log.info?.(`native: ${emu.name} ${rel.version} installed`);
      return manifest;
    } catch (e) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
  }

  async rollback(id) {
    const a = this.active(id);
    const prev = this.installs(id).find((i) => a && i.version !== a.version);
    if (!prev) return false;
    if (prev.source === "bundled") await fsp.rm(path.join(this.userDir, id, "active.json"), { force: true });
    else await fsp.writeFile(path.join(this.userDir, id, "active.json"), JSON.stringify({ version: prev.version }));
    return true;
  }

  async _prune(id) {
    // Keep the active update and the one before it.
    const a = this.active(id);
    const updates = this.installs(id).filter((i) => i.source === "update");
    const keep = new Set([a?.version, updates.find((i) => i.version !== a?.version)?.version]);
    for (const i of updates) if (!keep.has(i.version)) await fsp.rm(i.dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- helpers ----

export async function downloadToFile(url, file) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Phosphor" }, redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
      const want = Number(res.headers.get("content-length") || 0);
      if (want && fs.statSync(file).size !== want) throw new Error("download was cut short");
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
  throw new Error(`${url.split("/").pop()}: ${lastErr.message}`);
}

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], ...opts });
  let err = "";
  p.stderr.on("data", (d) => { err += d; });
  p.on("error", reject);
  p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} failed: ${err.trim().split("\n").pop() || code}`))));
});

// 7-Zip ships inside the app (7zip-bin); in a packaged app it lives outside the asar archive.
export function sevenZip() {
  const p = require("7zip-bin").path7za.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  try { fs.chmodSync(p, 0o755); } catch { /* read-only install: already executable */ }
  return p;
}

export async function extract(archive, dest, name = path.basename(archive)) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".appimage")) {
    const out = path.join(dest, name);
    await fsp.copyFile(archive, out);
    await fsp.chmod(out, 0o755);
    return;
  }
  if (lower.endsWith(".dmg")) {
    if (process.platform !== "darwin") throw new Error("macOS disk images can only be unpacked on a Mac.");
    const mnt = path.join(dest, ".mnt");
    await fsp.mkdir(mnt, { recursive: true });
    await run("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mnt, archive]);
    try {
      for (const e of await fsp.readdir(mnt)) if (e.endsWith(".app")) await run("cp", ["-R", path.join(mnt, e), dest]);
    } finally {
      await run("hdiutil", ["detach", mnt, "-force"]).catch(() => {});
      await fsp.rm(mnt, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }
  if (lower.endsWith(".zip") && process.platform === "darwin") return run("ditto", ["-x", "-k", archive, dest]); // keeps app bundles intact
  if (/\.tar\.(xz|gz)$/.test(lower) || lower.endsWith(".tgz")) return run("tar", ["-xf", archive, "-C", dest]);
  await run(sevenZip(), ["x", "-y", `-o${dest}`, archive]);
  // Some Windows zips store "folder\\file" names; unpacked elsewhere (building the Windows set on
  // Linux) those become one odd file name, so turn them back into folders.
  if (path.sep === "/") {
    for (const e of await fsp.readdir(dest)) {
      if (!e.includes("\\")) continue;
      const to = path.join(dest, ...e.split("\\"));
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.rename(path.join(dest, e), to);
    }
  }
}

// Path (relative to dir) of the program to run: a file, or a macOS .app folder.
export function findExe(dir, pattern, depth = 4) {
  const walk = (d, rel, level) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) if (pattern.test(e.name) && !e.name.startsWith(".")) return path.join(rel, e.name);
    if (level >= depth) return null;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name.endsWith(".app")) continue;
      const hit = walk(path.join(d, e.name), path.join(rel, e.name), level + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(dir, "", 0);
}
