import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { tmpdir, makeTar } from "./helpers.js";

// A fake npm registry that serves the runtime and every core at a version we control.
let server, registry, Emulators, ALL_CORES, SYSTEMS, version = "9.0.0";
const versions = {}; // per-package overrides: one emulator gets a release of its own
const vOf = (name) => versions[name] || version;
const SOURCES = ["emulator.js", "nipplejs.js", "shaders.js", "storage.js", "gamepad.js", "GameManager.js", "socket.io.min.js", "compression.js"];

function tarballFor(name) {
  const version = vOf(name);
  if (name === "@emulatorjs/emulatorjs") {
    const files = { "package/data/loader.js": `// loader ${version}`, "package/data/emulator.css": "body{}" };
    for (const f of SOURCES) files[`package/data/src/${f}`] = `// ${f} ${version}`;
    return makeTar(files);
  }
  const core = name.replace("@emulatorjs/core-", "");
  const threaded = SYSTEMS.some((s) => s.threads && s.cores.includes(core));
  const t = threaded ? "-thread" : "";
  return makeTar({ [`package/${core}${t}-wasm.data`]: `${core} ${version}`, [`package/${core}${t}-legacy-wasm.data`]: "x", [`package/reports/${core}.json`]: "{}", "package/package.json": "{}" });
}

before(async () => {
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url);
    if (url.endsWith("/latest")) {
      const name = url.slice(1, -"/latest".length);
      const tgz = tarballFor(name);
      const integrity = "sha512-" + crypto.createHash("sha512").update(tgz).digest("base64");
      res.end(JSON.stringify({ version: vOf(name), dist: { tarball: `${registry}/tgz/${encodeURIComponent(name)}`, integrity } }));
    } else if (url.startsWith("/tgz/")) {
      res.end(tarballFor(url.slice(5)));
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  registry = `http://127.0.0.1:${server.address().port}`;
  process.env.PHOSPHOR_NPM_REGISTRY = registry;
  ({ Emulators } = await import("../../server/emulators.js"));
  ({ ALL_CORES, SYSTEMS } = await import("../../server/systems.js"));
});
after(() => server.close());

test("one-button update installs a new set atomically, and rollback goes back", async () => {
  const userDir = tmpdir("phosphor-emu-");
  const emu = new Emulators({ bundledDir: null, userDir, log: {} });
  const phases = [];
  emu.onProgress((s) => phases.push(s.phase));

  const first = await emu.update();
  assert.equal(first.updated, true);
  const a = emu.active();
  assert.equal(a.runtime, "9.0.0");
  assert.equal(Object.keys(a.cores).length, ALL_CORES.length);
  const data = path.join(a.dir, "data");
  assert.match(fs.readFileSync(path.join(data, "emulator.min.js"), "utf8"), /GameManager\.js 9\.0\.0/);
  assert.ok(fs.existsSync(path.join(data, "cores", "ppsspp-thread-wasm.data")), "threaded core keeps thread build");
  assert.ok(!fs.existsSync(path.join(data, "cores", "snes9x-thread-wasm.data")), "unthreaded core drops thread build");
  assert.ok(phases.includes("downloading") && phases.at(-1) === "done");

  // Nothing new: pressing Update again is a no-op.
  assert.equal((await emu.update()).updated, false);

  // A new release appears: check reports it, update moves to it, rollback returns.
  version = "9.1.0";
  const check = await emu.check();
  assert.equal(check.upToDate, false);
  assert.ok(check.changes.length > ALL_CORES.length / 2);
  const second = await emu.update();
  assert.equal(second.updated, true);
  assert.equal(emu.active().runtime, "9.1.0");
  assert.equal(emu.summary().canRollback, true);
  await emu.rollback();
  assert.equal(emu.active().runtime, "9.0.0");
  assert.ok(!fs.readdirSync(userDir).some((f) => f.startsWith(".staging")), "no staging folders left behind");
});

test("a broken download leaves the current emulators untouched", async () => {
  const userDir = tmpdir("phosphor-emu-");
  version = "9.0.0";
  const emu = new Emulators({ bundledDir: null, userDir, log: {} });
  await emu.update();
  const before = emu.active().id;
  const realFetch = globalThis.fetch;
  version = "9.2.0";
  globalThis.fetch = async (url, opts) => (String(url).includes("/tgz/") && String(url).includes("snes9x") ? new Response("nope", { status: 500 }) : realFetch(url, opts));
  try {
    await assert.rejects(() => emu.update());
  } finally { globalThis.fetch = realFetch; }
  assert.equal(emu.active().id, before);
  assert.equal(emu.state.phase, "failed");
  assert.ok(!fs.readdirSync(userDir).some((f) => f.startsWith(".staging")));
});

test("each emulator can be updated and rolled back on its own", async () => {
  const userDir = tmpdir("phosphor-emu-");
  version = "9.0.0";
  const emu = new Emulators({ bundledDir: null, userDir, log: {} });
  await emu.update();
  const first = emu.active();
  versions["@emulatorjs/core-snes9x"] = "9.0.5";
  try {
    const check = await emu.check();
    assert.deepEqual(check.changes.map((c) => [c.kind, c.id, c.from, c.to]), [["core", "snes9x", "9.0.0", "9.0.5"]]);
    const r = await emu.update({ only: { kind: "core", id: "snes9x" } });
    assert.equal(r.updated, true);
    const now = emu.active();
    assert.notEqual(now.id, first.id, "a new install, so switching stays atomic");
    assert.equal(now.cores.snes9x, "9.0.5");
    assert.equal(now.cores.fceumm, "9.0.0", "other emulators unchanged");
    const cores = (d) => path.join(d, "data", "cores");
    assert.equal(fs.readFileSync(path.join(cores(now.dir), "snes9x-wasm.data"), "utf8"), "snes9x 9.0.5");
    assert.equal(fs.readFileSync(path.join(cores(first.dir), "snes9x-wasm.data"), "utf8"), "snes9x 9.0.0", "old install not written through a hard link");
    assert.equal(fs.statSync(path.join(cores(now.dir), "fceumm-wasm.data")).ino, fs.statSync(path.join(cores(first.dir), "fceumm-wasm.data")).ino, "unchanged files are shared");
    assert.equal(emu.state.check.upToDate, true, "update list cleared");
    assert.equal(emu.summary().itemPrevious.cores.snes9x, "9.0.0");
    assert.equal((await emu.update({ only: { kind: "core", id: "snes9x" } })).updated, false, "already current");

    await emu.rollbackOne({ kind: "core", id: "snes9x" });
    assert.equal(emu.active().cores.snes9x, "9.0.0");
    assert.equal(fs.readFileSync(path.join(cores(emu.active().dir), "snes9x-wasm.data"), "utf8"), "snes9x 9.0.0");

    versions["@emulatorjs/emulatorjs"] = "9.1.0";
    await emu.update({ only: { kind: "runtime", id: "runtime" } });
    assert.equal(emu.active().runtime, "9.1.0");
    assert.equal(emu.active().cores.snes9x, "9.0.0");
    assert.match(fs.readFileSync(path.join(emu.active().dir, "data", "emulator.min.js"), "utf8"), /9\.1\.0/);
    await assert.rejects(() => emu.update({ only: { kind: "core", id: "nope" } }));
  } finally {
    delete versions["@emulatorjs/core-snes9x"];
    delete versions["@emulatorjs/emulatorjs"];
  }
});

test("one emulator can be checked on its own (console pages)", async () => {
  const userDir = tmpdir("phosphor-emu-");
  version = "9.0.0";
  const emu = new Emulators({ bundledDir: null, userDir, log: {} });
  await emu.update();
  versions["@emulatorjs/core-snes9x"] = "9.0.7";
  try {
    const c = await emu.checkOne({ kind: "core", id: "snes9x" });
    assert.deepEqual([c.name, c.from, c.to, c.changed], ["Snes9x", "9.0.0", "9.0.7", true]);
    assert.equal((await emu.checkOne({ kind: "core", id: "fceumm" })).changed, false);
    await assert.rejects(() => emu.checkOne({ kind: "core", id: "nope" }));
  } finally { delete versions["@emulatorjs/core-snes9x"]; }
});
