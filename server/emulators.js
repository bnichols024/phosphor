// Emulator installs: the bundled set baked into the app, plus updates fetched by the one-button
// updater. Each install is a self-contained folder (EmulatorJS runtime + every core) with a
// manifest. Switching versions is just repointing "active", so updates are atomic and the previous
// install stays around for one-click rollback.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readTar } from "./lib/tar.js";
import { ALL_CORES, SYSTEMS, CORE_NAMES, coreName } from "./systems.js";

const REGISTRY = process.env.PHOSPHOR_NPM_REGISTRY || "https://registry.npmjs.org";
const RUNTIME_PKG = "@emulatorjs/emulatorjs";
const corePkg = (c) => `@emulatorjs/core-${c}`;
const THREAD_CORES = new Set(SYSTEMS.filter((s) => s.threads).flatMap((s) => s.cores));
// loader.js loads data/emulator.min.js; the npm package ships the sources, so we join them in the
// same order loader.js would load them one by one.
const RUNTIME_SOURCES = ["emulator.js", "nipplejs.js", "shaders.js", "storage.js", "gamepad.js", "GameManager.js", "socket.io.min.js", "compression.js"];

export class Emulators {
  constructor({ bundledDir, userDir, native = null, log = console }) {
    this.bundledDir = bundledDir; // read-only, shipped with the app
    this.userDir = userDir; // writable, holds updates
    this.native = native; // desktop emulators (desktop app only), updated by the same button
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
    const native = this.native?.summary() || [];
    const last = this._lastUpdate();
    return {
      active: a ? { id: a.id, runtime: a.runtime, cores: a.cores, installedAt: a.installedAt, source: a.source || (a.dir.startsWith(this.userDir) ? "update" : "bundled") } : null,
      native,
      // For each browser emulator, the version you'd go back to with its own "Previous version" button.
      itemPrevious: this._itemPrevious(a, installs),
      coreNames: CORE_NAMES,
      canRollback: last ? (last.web && !!prev) || native.some((n) => last.native?.includes(n.id) && n.previous) : !!prev,
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
      if (!a || a.runtime !== runtime.version) changes.push({ kind: "runtime", id: "runtime", name: "EmulatorJS runtime", from: a?.runtime || null, to: runtime.version });
      for (const c of cores) {
        const have = a?.cores?.[c.core] || null;
        if (have !== c.version) changes.push({ kind: "core", id: c.core, name: coreName(c.core), from: have, to: c.version });
      }
      for (const n of await this._nativeCheck()) if (n.changed) changes.push({ kind: "native", id: n.id, name: n.name, from: n.from, to: n.to, native: true });
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
  async update({ force = false, only = null } = {}) {
    if (only) return this.updateOne(only);
    if (this.state.running) throw new Error("An update is already running.");
    this._emit({ running: true, phase: "checking", done: 0, total: 0, message: "Checking for updates…", error: null });
    let staging = null;
    try {
      const a = this.active();
      const runtime = await this._latest(RUNTIME_PKG);
      const cores = await mapLimit(ALL_CORES, 6, async (c) => ({ core: c, ...(await this._latest(corePkg(c))) }));
      const webChanged = force || !a || a.runtime !== runtime.version || cores.some((c) => a.cores?.[c.core] !== c.version);
      const nativeJobs = (await this._nativeCheck()).filter((n) => n.changed);
      if (!webChanged && !nativeJobs.length) {
        this._emit({ running: false, phase: "idle", message: "Everything is already up to date.", check: { checkedAt: new Date().toISOString(), runtime: runtime.version, changes: [], upToDate: true } });
        return { updated: false, summary: this.summary() };
      }

      await fsp.mkdir(this.userDir, { recursive: true });
      const jobs = webChanged ? [{ kind: "runtime", ...runtime }, ...cores.map((c) => ({ kind: "core", ...c }))] : [];
      const total = jobs.length + nativeJobs.length;
      let done = 0;
      const changes = [];
      this._emit({ phase: "downloading", total, done: 0, message: `Downloading ${total} emulator packages…` });

      // Browser emulators: a whole new install folder, switched to only once it's complete.
      if (webChanged) {
        const id = `${runtime.version}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        staging = path.join(this.userDir, `.staging-${id}`);
        await fsp.rm(staging, { recursive: true, force: true });
        const data = path.join(staging, "data");
        await fsp.mkdir(path.join(data, "cores", "reports"), { recursive: true });
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
        verifyInstall(data);

        const manifest = { id, runtime: runtime.version, cores: versions, installedAt: new Date().toISOString() };
        await fsp.writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
        await fsp.rename(staging, path.join(this.userDir, id));
        staging = null;
        await this._setActive(id);
        await this._prune();
        if (a?.runtime !== runtime.version) changes.push({ name: "EmulatorJS runtime", from: a?.runtime || null, to: runtime.version });
        for (const c of ALL_CORES) if (a?.cores?.[c] !== versions[c]) changes.push({ name: c, from: a?.cores?.[c] || null, to: versions[c] });
        this.log.info?.(`emulators: switched to ${id}`);
      }

      // Desktop emulators: each one unpacks into its own folder and switches on its own.
      const nativeDone = [];
      try {
        for (const n of nativeJobs) {
          this._emit({ phase: "downloading", message: `${n.name} ${n.to}` });
          await this.native.install(n.id, n.release, { onProgress: (message) => this._emit({ message }) });
          nativeDone.push(n.id);
          changes.push({ name: n.name, from: n.from, to: n.to });
          done += 1;
          this._emit({ done });
        }
      } finally {
        await fsp.writeFile(path.join(this.userDir, "last-update.json"), JSON.stringify({ web: webChanged, native: nativeDone, at: new Date().toISOString() }));
      }

      this._emit({ running: false, phase: "done", message: changes.length ? `Updated ${changes.length} emulator${changes.length === 1 ? "" : "s"}.` : "Reinstalled every emulator.", check: { checkedAt: new Date().toISOString(), runtime: runtime.version, changes: [], upToDate: true } });
      return { updated: true, changes, summary: this.summary() };
    } catch (e) {
      if (staging) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
      this._emit({ running: false, phase: "failed", error: e.message, message: "Update failed. Your current emulators are untouched." });
      throw e;
    }
  }

  // ---- one emulator at a time ----
  // Is there a newer version of just this one? (For the console pages.)
  async checkOne({ kind, id } = {}) {
    if (kind === "native") {
      if (!this.native) throw new Error("Desktop emulators only exist in the desktop app.");
      const n = await this.native.checkOne(id);
      const prev = this.native.summary().find((x) => x.id === id)?.previous || null;
      return { kind, id, name: n.name, from: n.from, to: n.to, changed: n.changed, previous: prev };
    }
    if (kind !== "core" || !ALL_CORES.includes(id)) throw new Error("Unknown emulator.");
    const a = this.active();
    const latest = await this._latest(corePkg(id));
    const from = a?.cores?.[id] || null;
    return { kind, id, name: coreName(id), from, to: latest.version, changed: from !== latest.version, previous: a ? this._itemPrevious(a, this.listInstalls()).cores[id] || null : null };
  }

  // only: { kind: "runtime" | "core" | "native", id }. Browser emulators still get a whole new
  // install folder (so switching stays atomic and Undo works), but every other file is hard-linked
  // from the current one, so it's quick and takes no extra space.
  async updateOne(only) {
    if (this.state.running) throw new Error("An update is already running.");
    const { kind, id } = only || {};
    if (kind === "core" && !ALL_CORES.includes(id)) throw new Error(`Unknown emulator ${id}.`);
    if (!["runtime", "core", "native"].includes(kind)) throw new Error("Unknown emulator.");
    this._emit({ running: true, phase: "checking", done: 0, total: 1, message: "Checking for an update…", error: null });
    let staging = null;
    try {
      let changed;
      if (kind === "native") {
        if (!this.native) throw new Error("Desktop emulators only exist in the desktop app.");
        const n = (await this.native.check()).find((x) => x.id === id);
        if (!n) throw new Error(`Unknown emulator ${id}.`);
        if (!n.changed) return this._doneOne(`${n.name} is already up to date.`, false);
        this._emit({ phase: "downloading", message: `${n.name} ${n.to}` });
        await this.native.install(id, n.release, { onProgress: (message) => this._emit({ message }) });
        await this._writeLastUpdate({ web: false, native: [id] });
        changed = { kind, id, name: n.name, from: n.from, to: n.to };
      } else {
        const a = this.active();
        if (!a) throw new Error("Install the emulators first: press Update.");
        const latest = await this._latest(kind === "runtime" ? RUNTIME_PKG : corePkg(id));
        const have = kind === "runtime" ? a.runtime : a.cores?.[id];
        const label = kind === "runtime" ? "EmulatorJS" : coreName(id);
        if (have === latest.version) return this._doneOne(`${label} is already up to date.`, false);
        const newId = `${kind === "runtime" ? latest.version : a.runtime}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        staging = path.join(this.userDir, `.staging-${newId}`);
        await fsp.rm(staging, { recursive: true, force: true });
        await fsp.mkdir(path.join(staging, "data", "cores", "reports"), { recursive: true });
        // Everything except the part being replaced comes from the current install.
        await linkTree(a.dir, staging, (rel) => rel === "manifest.json" || (kind === "runtime" ? !rel.startsWith(CORES_DIR) : isCoreFile(rel, id)));
        this._emit({ phase: "downloading", message: `${label} ${latest.version}` });
        const entries = readTar(await download(latest.tarball, latest.integrity));
        const data = path.join(staging, "data");
        if (kind === "runtime") await writeRuntime(entries, data);
        else await writeCore(entries, data, id);
        const cores = { ...a.cores, ...(kind === "core" ? { [id]: latest.version } : {}) };
        await this._finishInstall(staging, { id: newId, runtime: kind === "runtime" ? latest.version : a.runtime, cores });
        staging = null;
        changed = { kind, id, name: label, from: have || null, to: latest.version };
      }
      this._emit({ done: 1 });
      return this._doneOne(`Updated ${changed.name} to ${changed.to}.`, true, changed);
    } catch (e) {
      if (staging) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
      this._emit({ running: false, phase: "failed", error: e.message, message: "Update failed. Your current emulators are untouched." });
      throw e;
    }
  }

  // Go back to the previous version of just one emulator.
  async rollbackOne({ kind, id } = {}) {
    if (this.state.running) throw new Error("An update is running.");
    if (kind === "native") {
      const before = this.native?.summary().find((n) => n.id === id);
      if (!before?.previous || !(await this.native.rollback(id))) throw new Error("There's no earlier version to go back to.");
      this._emit({ phase: "done", message: `Back on ${before.name} ${before.previous}.`, error: null });
      return this.summary();
    }
    const a = this.active();
    const from = a && this._olderInstall(a, kind, id);
    if (!from) throw new Error("There's no earlier version to go back to.");
    const newId = `${kind === "runtime" ? from.runtime : a.runtime}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    let staging = path.join(this.userDir, `.staging-${newId}`);
    try {
      await fsp.mkdir(path.join(staging, "data", "cores", "reports"), { recursive: true });
      const target = (rel) => (kind === "runtime" ? !rel.startsWith(CORES_DIR) : isCoreFile(rel, id));
      await linkTree(a.dir, staging, (rel) => rel === "manifest.json" || target(rel));
      await linkTree(from.dir, staging, (rel) => rel === "manifest.json" || !target(rel));
      const cores = { ...a.cores, ...(kind === "core" ? { [id]: from.cores[id] } : {}) };
      await this._finishInstall(staging, { id: newId, runtime: kind === "runtime" ? from.runtime : a.runtime, cores });
      staging = null;
    } finally {
      if (staging) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
    const label = kind === "runtime" ? "EmulatorJS" : coreName(id);
    this._emit({ phase: "done", message: `Back on ${label} ${kind === "runtime" ? from.runtime : from.cores[id]}.`, error: null });
    return this.summary();
  }

  // The newest other install with a different version of this emulator.
  _olderInstall(a, kind, id) {
    return this.listInstalls().find((i) => i.id !== a.id && (kind === "runtime" ? i.runtime && i.runtime !== a.runtime : i.cores?.[id] && i.cores[id] !== a.cores?.[id]));
  }

  _itemPrevious(a, installs) {
    if (!a) return { runtime: null, cores: {} };
    const others = installs.filter((i) => i.id !== a.id);
    const cores = {};
    for (const c of Object.keys(a.cores || {})) {
      const o = others.find((i) => i.cores?.[c] && i.cores[c] !== a.cores[c]);
      if (o) cores[c] = o.cores[c];
    }
    return { runtime: others.find((i) => i.runtime && i.runtime !== a.runtime)?.runtime || null, cores };
  }

  async _finishInstall(staging, { id, runtime, cores }) {
    this._emit({ phase: "verifying", message: "Checking the new emulators…" });
    verifyInstall(path.join(staging, "data"));
    await fsp.writeFile(path.join(staging, "manifest.json"), JSON.stringify({ id, runtime, cores, installedAt: new Date().toISOString() }, null, 2));
    await fsp.rename(staging, path.join(this.userDir, id));
    await this._setActive(id);
    await this._prune();
    await this._writeLastUpdate({ web: true, native: [] });
    this.log.info?.(`emulators: switched to ${id}`);
  }

  async _writeLastUpdate(info) {
    await fsp.mkdir(this.userDir, { recursive: true });
    await fsp.writeFile(path.join(this.userDir, "last-update.json"), JSON.stringify({ ...info, at: new Date().toISOString() }));
  }

  _doneOne(message, updated, change = null) {
    // The update list loses the item that was just installed.
    let check = this.state.check;
    if (check && change) {
      const changes = check.changes.filter((c) => !(c.kind === change.kind && c.id === change.id));
      check = { ...check, changes, upToDate: changes.length === 0 };
    }
    this._emit({ running: false, phase: "done", message, check });
    return { updated, change, summary: this.summary() };
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

  _lastUpdate() { return this.userDir ? this._readJson(path.join(this.userDir, "last-update.json")) : null; }

  async _nativeCheck() {
    if (!this.native) return [];
    try { return await this.native.check(); } catch (e) { this.log.warn?.(`desktop emulators: ${e.message}`); return []; }
  }

  // Undo the last press of Update: whichever emulators it changed go back to what was there before.
  async rollback() {
    if (this.state.running) throw new Error("An update is running.");
    const last = this._lastUpdate();
    let undone = 0;
    for (const id of last?.native || []) if (await this.native?.rollback(id)) undone++;
    const a = this.active();
    const prev = this.listInstalls().find((i) => i.id !== a?.id);
    if (last && (!last.web || !prev)) {
      if (!undone) throw new Error("There's no earlier version to go back to.");
      await fsp.rm(path.join(this.userDir, "last-update.json"), { force: true });
      this._emit({ phase: "done", message: "Previous desktop emulators restored.", error: null });
      return this.summary();
    }
    if (!prev) throw new Error("There's no earlier version to go back to.");
    await fsp.rm(path.join(this.userDir, "last-update.json"), { force: true }).catch(() => {});
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

const CORES_DIR = "data/cores/";
// Files in an install that belong to one core ("snes9x-wasm.data", "reports/snes9x.json"...).
const isCoreFile = (rel, core) => rel.startsWith(CORES_DIR) && (path.posix.basename(rel).startsWith(`${core}-`) || rel === `${CORES_DIR}reports/${core}.json`);

export function verifyInstall(data) {
  for (const c of ALL_CORES) {
    const want = `${c}${THREAD_CORES.has(c) ? "-thread" : ""}-wasm.data`;
    if (!fs.existsSync(path.join(data, "cores", want))) throw new Error(`The ${c} package is missing ${want}.`);
  }
  for (const f of ["loader.js", "emulator.min.js", "emulator.min.css"]) {
    if (!fs.existsSync(path.join(data, f))) throw new Error(`The runtime package is missing ${f}.`);
  }
}

// Recreate `src` under `dest` with hard links (falling back to copies), skipping files `skip`
// says no to. Paths given to `skip` are relative with forward slashes.
export async function linkTree(src, dest, skip = () => false, rel = "") {
  for (const e of await fsp.readdir(path.join(src, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await fsp.mkdir(path.join(dest, r), { recursive: true });
      await linkTree(src, dest, skip, r);
    } else if (!skip(r)) {
      const to = path.join(dest, r);
      await fsp.rm(to, { force: true });
      try { await fsp.link(path.join(src, r), to); } catch { await fsp.copyFile(path.join(src, r), to); }
    }
  }
}

// New files never write through a hard link into an older install: remove, then write.
async function writeFresh(file, data) {
  await fsp.rm(file, { force: true });
  await fsp.writeFile(file, data);
}

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
    await writeFresh(out, e.data);
  }
  const missing = RUNTIME_SOURCES.filter((f) => !sources[f]);
  if (missing.length) throw new Error(`runtime package is missing ${missing.join(", ")}`);
  const joined = RUNTIME_SOURCES.map((f) => `/* ${f} */\n${sources[f].toString("utf8")}\n;`).join("\n");
  await writeFresh(path.join(dataDir, "emulator.min.js"), joined);
  await writeFresh(path.join(dataDir, "emulator.min.css"), await fsp.readFile(path.join(dataDir, "emulator.css")));
}

export async function writeCore(entries, dataDir, core) {
  let wrote = 0;
  for (const e of entries) {
    if (e.type !== "file" || !e.name.startsWith("package/")) continue;
    const rel = e.name.slice("package/".length);
    if (rel === "package.json" || rel.toLowerCase().startsWith("readme")) continue;
    if (rel.startsWith("reports/")) {
      await writeFresh(path.join(dataDir, "cores", "reports", path.basename(rel)), e.data);
      continue;
    }
    if (rel.includes("/") || !keepCoreFile(core, rel)) continue;
    await writeFresh(path.join(dataDir, "cores", rel), e.data);
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
