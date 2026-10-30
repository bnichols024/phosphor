// Emulator installs: the bundled set baked into the app, plus updates fetched by the one-button
// updater. Each install is a self-contained folder (EmulatorJS runtime + every core) with a
// manifest. Switching versions is just repointing "active", so updates are atomic and the previous
// install stays around for one-click rollback.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readTar } from "./lib/tar.js";
import { ALL_CORES, SYSTEMS } from "./systems.js";

const REGISTRY = process.env.PHOSPHOR_NPM_REGISTRY || "https://registry.npmjs.org";
const RUNTIME_PKG = "@emulatorjs/emulatorjs";
const corePkg = (c) => `@emulatorjs/core-${c}`;
const THREAD_CORES = new Set(SYSTEMS.filter((s) => s.threads).flatMap((s) => s.cores));
// loader.js loads data/emulator.min.js; the npm package ships the sources, so we join them in the
// same order loader.js would load them one by one.
const RUNTIME_SOURCES = ["emulator.js", "nipplejs.js", "shaders.js", "storage.js", "gamepad.js", "GameManager.js", "socket.io.min.js", "compression.js"];

export class Emulators {
  constructor({ bundledDir, userDir, log = console }) {
    this.bundledDir = bundledDir; // read-only, shipped with the app
    this.userDir = userDir; // writable, holds updates
    this.log = log;
    this.state = { running: false, phase: "idle", done: 0, total: 0, message: "", error: null, lastCheck: null, check: null };
    this.listeners = new Set();
    this._active = null;
  }

  onProgress(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(patch) {
    Object.assign(this.state, patch);
    for (const fn of this.listeners) { try { fn({ ...this.state }); } catch { /* listener errors don't stop updates */ } }
  }

  // ---- installs ----
  _readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }

  listInstalls() {
    const out = [];
    for (const [root, source] of [[this.userDir, "update"], [this.bundledDir, "bundled"]]) {
      if (!root || !fs.existsSync(root)) continue;
      for (const name of fs.readdirSync(root)) {
        const m = this._readJson(path.join(root, name, "manifest.json"));
        if (m) out.push({ ...m, source, dir: path.join(root, name) });
      }
    }
    return out.sort((a, b) => (b.installedAt || "").localeCompare(a.installedAt || ""));
  }

  active() {
    if (this._active && fs.existsSync(this._active.dir)) return this._active;
    const pick = (root) => {
      const a = root && this._readJson(path.join(root, "active.json"));
      if (!a) return null;
      const dir = path.join(root, a.id);
      const m = this._readJson(path.join(dir, "manifest.json"));
      return m ? { ...m, dir } : null;
    };
    this._active = pick(this.userDir) || pick(this.bundledDir) || this.listInstalls()[0] || null;
    return this._active;
  }

  dataDir() { const a = this.active(); return a ? path.join(a.dir, "data") : null; }

  hasCore(core) {
    const d = this.dataDir();
    return !!d && fs.existsSync(path.join(d, "cores", `${core}${THREAD_CORES.has(core) ? "-thread" : ""}-wasm.data`));
  }

  summary() {
    const a = this.active();
    const installs = this.listInstalls();
    const prev = installs.find((i) => a && i.id !== a.id && i.source === "update") || installs.find((i) => a && i.id !== a.id);
    return {
      active: a ? { id: a.id, runtime: a.runtime, cores: a.cores, installedAt: a.installedAt, source: a.source || (a.dir.startsWith(this.userDir) ? "update" : "bundled") } : null,
      canRollback: !!prev,
      previous: prev ? { id: prev.id, runtime: prev.runtime, installedAt: prev.installedAt } : null,
      state: { ...this.state },
    };
  }

  // ---- registry ----
  async _latest(pkg) {
    const res = await fetch(`${REGISTRY}/${pkg.replace("/", "%2f")}/latest`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${pkg}: registry answered ${res.status}`);
    const j = await res.json();
    return { name: pkg, version: j.version, tarball: j.dist.tarball, integrity: j.dist.integrity, size: j.dist.unpackedSize || 0 };
  }

  async check() {
    this._emit({ phase: "checking", message: "Checking for new emulator versions…", error: null });
    try {
      const a = this.active();
      const runtime = await this._latest(RUNTIME_PKG);
      const cores = await mapLimit(ALL_CORES, 6, async (c) => ({ core: c, ...(await this._latest(corePkg(c))) }));
      const changes = [];
      if (!a || a.runtime !== runtime.version) changes.push({ name: "EmulatorJS runtime", from: a?.runtime || null, to: runtime.version });
      for (const c of cores) {
        const have = a?.cores?.[c.core] || null;
        if (have !== c.version) changes.push({ name: c.core, from: have, to: c.version });
      }
      const check = { checkedAt: new Date().toISOString(), runtime: runtime.version, changes, upToDate: changes.length === 0 };
      this._emit({ phase: this.state.running ? this.state.phase : "idle", message: "", lastCheck: check.checkedAt, check });
      return check;
    } catch (e) {
      this._emit({ phase: "idle", message: "", error: `Couldn't reach the update server (${e.message}).` });
      throw e;
    }
  }

  // The one-button update: fetch the newest runtime and every core, build a fresh install next to
  // the current one, verify it, then switch over. Nothing changes if any step fails.
  async update({ force = false } = {}) {
    if (this.state.running) throw new Error("An update is already running.");
    this._emit({ running: true, phase: "checking", done: 0, total: 0, message: "Checking for updates…", error: null });
    let staging = null;
    try {
      const a = this.active();
      const runtime = await this._latest(RUNTIME_PKG);
      const cores = await mapLimit(ALL_CORES, 6, async (c) => ({ core: c, ...(await this._latest(corePkg(c))) }));
      const changed = !a || a.runtime !== runtime.version || cores.some((c) => a.cores?.[c.core] !== c.version);
      if (!changed && !force) {
        this._emit({ running: false, phase: "idle", message: "Everything is already up to date.", check: { checkedAt: new Date().toISOString(), runtime: runtime.version, changes: [], upToDate: true } });
        return { updated: false, summary: this.summary() };
      }

      const id = `${runtime.version}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await fsp.mkdir(this.userDir, { recursive: true });
      staging = path.join(this.userDir, `.staging-${id}`);
      await fsp.rm(staging, { recursive: true, force: true });
      const data = path.join(staging, "data");
      await fsp.mkdir(path.join(data, "cores", "reports"), { recursive: true });

      const jobs = [{ kind: "runtime", ...runtime }, ...cores.map((c) => ({ kind: "core", ...c }))];
      this._emit({ phase: "downloading", total: jobs.length, done: 0, message: `Downloading ${jobs.length} emulator packages…` });
      let done = 0;
      const versions = {};
      await mapLimit(jobs, 4, async (job) => {
        // Reuse the unchanged core from the current install instead of downloading it again.
        if (!force && job.kind === "core" && a?.cores?.[job.core] === job.version && this._copyCoreFrom(a.dir, data, job.core)) {
          versions[job.core] = job.version;
        } else {
          const buf = await download(job.tarball, job.integrity);
          const entries = readTar(buf);
          if (job.kind === "runtime") await writeRuntime(entries, data);
          else { await writeCore(entries, data, job.core); versions[job.core] = job.version; }
        }
        done += 1;
        this._emit({ done, message: job.kind === "runtime" ? `EmulatorJS ${job.version}` : `${job.core} ${job.version}` });
      });

      this._emit({ phase: "verifying", message: "Checking the new emulators…" });
      for (const c of ALL_CORES) {
        const want = `${c}${THREAD_CORES.has(c) ? "-thread" : ""}-wasm.data`;
        if (!fs.existsSync(path.join(data, "cores", want))) throw new Error(`The ${c} package is missing ${want}.`);
      }
      for (const f of ["loader.js", "emulator.min.js", "emulator.min.css"]) {
        if (!fs.existsSync(path.join(data, f))) throw new Error(`The runtime package is missing ${f}.`);
      }

      const manifest = { id, runtime: runtime.version, cores: versions, installedAt: new Date().toISOString() };
      await fsp.writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
      const final = path.join(this.userDir, id);
      await fsp.rename(staging, final);
      staging = null;
      await this._setActive(id);
      await this._prune();
      const changes = [];
      if (a?.runtime !== runtime.version) changes.push({ name: "EmulatorJS runtime", from: a?.runtime || null, to: runtime.version });
      for (const c of ALL_CORES) if (a?.cores?.[c] !== versions[c]) changes.push({ name: c, from: a?.cores?.[c] || null, to: versions[c] });
      this._emit({ running: false, phase: "done", message: changes.length ? `Updated ${changes.length} emulator${changes.length === 1 ? "" : "s"}.` : "Reinstalled every emulator.", check: { checkedAt: new Date().toISOString(), runtime: runtime.version, changes: [], upToDate: true } });
      this.log.info?.(`emulators: switched to ${id}`);
      return { updated: true, changes, summary: this.summary() };
    } catch (e) {
      if (staging) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
      this._emit({ running: false, phase: "failed", error: e.message, message: "Update failed. Your current emulators are untouched." });
      throw e;
    }
  }

  _copyCoreFrom(fromDir, toData, core) {
    const src = path.join(fromDir, "data", "cores");
    try {
      const files = fs.readdirSync(src).filter((f) => f.startsWith(`${core}-`) && keepCoreFile(core, f));
      if (!files.length) return false;
      for (const f of files) fs.copyFileSync(path.join(src, f), path.join(toData, "cores", f));
      const rep = path.join(src, "reports", `${core}.json`);
      if (fs.existsSync(rep)) fs.copyFileSync(rep, path.join(toData, "cores", "reports", `${core}.json`));
      return true;
    } catch { return false; }
  }

  async _setActive(id) {
    await fsp.writeFile(path.join(this.userDir, "active.json"), JSON.stringify({ id, at: new Date().toISOString() }));
    this._active = null;
  }

  async rollback() {
    if (this.state.running) throw new Error("An update is running.");
    const a = this.active();
    const prev = this.listInstalls().find((i) => i.id !== a?.id);
    if (!prev) throw new Error("There's no earlier version to go back to.");
    if (prev.source === "bundled") {
      // Going back to the built-in set: drop the pointer so the bundled install wins again.
      await fsp.rm(path.join(this.userDir, "active.json"), { force: true });
    } else {
      await this._setActive(prev.id);
    }
    this._active = null;
    this._emit({ phase: "done", message: `Back on emulators from ${prev.installedAt?.slice(0, 10) || "before"}.`, error: null });
    return this.summary();
  }

  async _prune() {
    // Keep the active install and the newest other update; delete the rest.
    const a = this.active();
    const updates = this.listInstalls().filter((i) => i.source === "update");
    const keep = new Set([a?.id, updates.find((i) => i.id !== a?.id)?.id]);
    for (const i of updates) if (!keep.has(i.id)) await fsp.rm(i.dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- helpers shared with tools/fetch-emulators.mjs ----

export function keepCoreFile(core, file) {
  if (!file.endsWith(".data")) return true; // assets like ppsspp-assets.zip
  return THREAD_CORES.has(core) ? file.includes("-thread") : !file.includes("-thread");
}

export async function download(url, integrity) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (integrity) {
        const [algo, want] = integrity.split(" ")[0].split(/-(.*)/s);
        const got = crypto.createHash(algo).update(buf).digest("base64");
        if (got !== want) throw new Error("checksum mismatch");
      }
      return buf;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`${url.split("/").pop()}: ${lastErr.message}`);
}

export async function writeRuntime(entries, dataDir) {
  const prefix = "package/data/";
  const sources = {};
  for (const e of entries) {
    if (e.type !== "file" || !e.name.startsWith(prefix)) continue;
    const rel = e.name.slice(prefix.length);
    if (rel.startsWith("cores/")) continue;
    if (rel.startsWith("src/")) sources[rel.slice(4)] = e.data;
    const out = path.join(dataDir, rel);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, e.data);
  }
  const missing = RUNTIME_SOURCES.filter((f) => !sources[f]);
  if (missing.length) throw new Error(`runtime package is missing ${missing.join(", ")}`);
  const joined = RUNTIME_SOURCES.map((f) => `/* ${f} */\n${sources[f].toString("utf8")}\n;`).join("\n");
  await fsp.writeFile(path.join(dataDir, "emulator.min.js"), joined);
  await fsp.copyFile(path.join(dataDir, "emulator.css"), path.join(dataDir, "emulator.min.css"));
}

export async function writeCore(entries, dataDir, core) {
  let wrote = 0;
  for (const e of entries) {
    if (e.type !== "file" || !e.name.startsWith("package/")) continue;
    const rel = e.name.slice("package/".length);
    if (rel === "package.json" || rel.toLowerCase().startsWith("readme")) continue;
    if (rel.startsWith("reports/")) {
      await fsp.writeFile(path.join(dataDir, "cores", "reports", path.basename(rel)), e.data);
      continue;
    }
    if (rel.includes("/") || !keepCoreFile(core, rel)) continue;
    await fsp.writeFile(path.join(dataDir, "cores", rel), e.data);
    wrote += 1;
  }
  if (!wrote) throw new Error(`${core} package had no emulator files`);
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
