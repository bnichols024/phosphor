import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { identify, referencedFiles } from "../../server/identify.js";
import { GameDB } from "../../server/gamedb.js";
import { groupGames } from "../../server/library.js";
import { tmpdir, makeZip } from "./helpers.js";

// A fake GitHub + Dolphin update feed serving tiny "emulators".
let fake, base, catalog, manager, NativeEmulators, findExe;
const releases = { flycast: "v2.7", dolphin: "2609a" };
before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    if (u.pathname === "/repos/flyinghead/flycast/releases/latest") {
      const v = releases.flycast.slice(1);
      return send({ tag_name: releases.flycast, assets: [
        { name: `flycast-win64-${v}.zip`, browser_download_url: `${base}/dl/flycast.zip`, size: 1 },
        { name: `flycast-x86_64-${v}.AppImage`, browser_download_url: `${base}/dl/flycast.AppImage`, size: 1 },
      ] });
    }
    if (u.pathname === "/repos/pkgforge-dev/Dolphin-emu-AppImage/releases/latest") {
      return send({ tag_name: `${releases.dolphin}@2026-10-22_1`, assets: [{ name: `Dolphin_Emulator-${releases.dolphin}-anylinux-x86_64.AppImage`, browser_download_url: `${base}/dl/dolphin.AppImage`, size: 1 }] });
    }
    if (u.pathname === "/dolphin-feed") return send({ shortrev: releases.dolphin, artifacts: [{ system: "Windows x64", url: `${base}/dl/dolphin-${releases.dolphin}-x64.7z` }] });
    if (u.pathname === "/dl/flycast.zip") return res.end(makeZip({ "flycast.exe": "MZ fake", "README.txt": "hi" }));
    if (u.pathname.endsWith(".AppImage")) return res.end("#!/bin/sh\necho fake\n");
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${fake.address().port}`;
  process.env.PHOSPHOR_GITHUB_API = base;
  process.env.PHOSPHOR_DOLPHIN_FEED = `${base}/dolphin-feed`;
  catalog = await import("../../server/native/catalog.js");
  manager = await import("../../server/native/manager.js");
  ({ NativeEmulators, findExe } = manager);
});
after(() => fake.close());

test("newest build is picked per OS from GitHub or Dolphin's update feed", async () => {
  const { NATIVE, latestRelease } = catalog;
  const fly = await latestRelease(NATIVE.flycast, "win32");
  assert.equal(fly.version, "2.7");
  assert.match(fly.file, /win64/);
  assert.equal((await latestRelease(NATIVE.flycast, "linux")).file, "flycast-x86_64-2.7.AppImage");
  const dol = await latestRelease(NATIVE.dolphin, "linux");
  assert.equal(dol.version, "2609a", "community AppImage tag trimmed to Dolphin's version");
  assert.equal((await latestRelease(NATIVE.dolphin, "win32")).file, "dolphin-2609a-x64.7z");
});

test("install unpacks, finds the program, switches over, and undo goes back", async () => {
  const root = tmpdir("phosphor-native-");
  const n = new NativeEmulators({ bundledDir: path.join(root, "bundled"), userDir: path.join(root, "user"), platform: "win32", log: {} });
  const rel = await catalog.latestRelease(catalog.NATIVE.flycast, "win32");
  // First install goes into the "bundled" folder (what tools/fetch-native-emulators.mjs does).
  await n.install("flycast", rel, { root: path.join(root, "bundled") });
  assert.equal(n.active("flycast").source, "bundled");
  assert.ok(n.exePath("flycast").endsWith(path.join("2.7", "flycast.exe")));
  // An update lands in the user folder and wins.
  releases.flycast = "v2.8";
  const check = await n.check();
  assert.deepEqual(check.filter((c) => c.changed && c.id === "flycast").map((c) => [c.id, c.from, c.to]), [["flycast", "2.7", "2.8"]]);
  await n.install("flycast", check[0].release);
  assert.equal(n.active("flycast").version, "2.8");
  assert.equal(n.active("flycast").source, "update");
  assert.equal(n.summary().find((s) => s.id === "flycast").previous, "2.7");
  assert.equal(await n.rollback("flycast"), true);
  assert.equal(n.active("flycast").version, "2.7");
  assert.equal(n.active("flycast").source, "bundled");
  releases.flycast = "v2.7";
  fs.rmSync(root, { recursive: true, force: true });
});

test("findExe locates programs and macOS app bundles", () => {
  const d = tmpdir("phosphor-exe-");
  fs.mkdirSync(path.join(d, "Dolphin-x64"), { recursive: true });
  fs.writeFileSync(path.join(d, "Dolphin-x64", "Dolphin.exe"), "");
  fs.mkdirSync(path.join(d, "Flycast.app", "Contents", "MacOS"), { recursive: true });
  assert.equal(findExe(d, /^Dolphin\.exe$/i), path.join("Dolphin-x64", "Dolphin.exe"));
  assert.equal(findExe(d, /^Flycast\.app$/i), "Flycast.app");
  fs.rmSync(d, { recursive: true, force: true });
});

test("launch arguments: full screen, saves in the player's folder, back to Phosphor on exit", () => {
  const { NATIVE } = catalog;
  const d = tmpdir("phosphor-args-");
  const dol = NATIVE.dolphin.launch({ game: "/g/Zelda.rvz", saveDir: d, dataDir: d, platform: "win32" });
  assert.deepEqual(dol.args.slice(0, 3), ["-b", "-u", d]);
  assert.ok(dol.args.includes("Dolphin.Display.Fullscreen=True"));
  assert.deepEqual(dol.args.slice(-2), ["-e", "/g/Zelda.rvz"]);
  assert.match(fs.readFileSync(path.join(d, "Config", "GCPadNew.ini"), "utf8"), /Device = XInput\/0\/Gamepad/, "Windows pads mapped");
  const fly = NATIVE.flycast.launch({ game: "/g/Crazy Taxi.gdi", saveDir: "C:\\Saves\\P1\\Dreamcast", dataDir: d });
  assert.ok(fly.args.includes("window:fullscreen=yes"));
  assert.ok(fly.args.includes('config:Dreamcast.VMUPath="C:\\Saves\\P1\\Dreamcast"'), "Windows path survives the : in C:");
  assert.equal(fly.args.at(-1), "/g/Crazy Taxi.gdi");
  fs.rmSync(d, { recursive: true, force: true });
});

test("GameCube, Wii and Dreamcast discs are recognised from their headers", async () => {
  const gamedb = new GameDB(path.join(import.meta.dirname, "..", "..", "db"));
  const dir = tmpdir("phosphor-discs-");
  const put = (name, data) => { const p = path.join(dir, name); fs.writeFileSync(p, data); return p; };
  const gc = Buffer.alloc(0x10000); gc.write("GALE01", 0); gc.writeUInt32BE(0xc2339f3d, 0x1c);
  const wii = Buffer.alloc(0x10000); wii.write("RMGE01", 0); wii.writeUInt32BE(0x5d1c9ea3, 0x18);
  const rvz = Buffer.alloc(0x200); rvz.write("RVZ\x01", 0, "latin1"); rvz.writeUInt32BE(2, 0x48);
  const gcz = Buffer.alloc(0x200); gcz.writeUInt32LE(0xb10bc001, 0); gcz.writeUInt32LE(0, 4);
  const wbfs = Buffer.alloc(0x200); wbfs.write("WBFS", 0);
  const wiiwad = Buffer.alloc(0x200); wiiwad.writeUInt32BE(0x20, 0); wiiwad.write("Is", 4);
  const melee = await identify(put("Smash.iso", gc), { gamedb });
  assert.equal(melee.system, "gamecube");
  assert.match(melee.match?.name || "", /Super Smash Bros\. Melee \(USA\)/, "named from the disc's game code");
  assert.equal((await identify(put("Galaxy.iso", wii), { gamedb })).system, "wii");
  assert.equal((await identify(put("Galaxy 2.rvz", rvz), { gamedb })).system, "wii");
  assert.equal((await identify(put("Melee.gcz", gcz), { gamedb })).system, "gamecube");
  assert.equal((await identify(put("Party.wbfs", wbfs), { gamedb })).system, "wii");
  assert.equal((await identify(put("Channel.wad", wiiwad), { gamedb })).system, "wii");
  assert.equal((await identify(put("doom2.wad", Buffer.from("IWAD\0\0\0\0\0\0\0\0")), { gamedb })).system, "doom", "Doom data still goes to Doom");
  // Dreamcast GD-ROM dump: .gdi plus its tracks are one game.
  // Raw 2352-byte sectors: sync pattern, mode 1, then the IP.BIN header.
  const ip = Buffer.alloc(2352 * 20); ip.fill(0xff, 1, 11); ip[15] = 1; ip.write("SEGA SEGAKATANA ", 0x10);
  put("track01.bin", ip); put("track02.raw", Buffer.alloc(100)); put("track03.bin", ip);
  const gdi = put("Sonic Adventure.gdi", '3\n1 0 4 2352 track01.bin 0\n2 450 0 2352 "track02.raw" 0\n3 45000 4 2352 track03.bin 0\n');
  assert.deepEqual((await referencedFiles(gdi)).map((f) => path.basename(f)), ["track01.bin", "track02.raw", "track03.bin"]);
  assert.equal((await identify(gdi, { gamedb })).system, "dreamcast");
  const groups = await groupGames(fs.readdirSync(dir).filter((f) => /track|Sonic/.test(f)).map((f) => path.join(dir, f)));
  assert.equal(groups.length, 1, "tracks belong to the .gdi");
  put("Crazy Taxi.cue", 'FILE "ct.bin" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\n');
  put("ct.bin", ip);
  assert.equal((await identify(path.join(dir, "Crazy Taxi.cue"), { gamedb })).system, "dreamcast");
  fs.rmSync(dir, { recursive: true, force: true });
});

// A pretend emulator process: exits when told to, like a player quitting the game.
function fakeSpawn(calls) {
  return (program, args, opts) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => setTimeout(() => child.emit("exit", 0), 5);
    calls.push({ program, args, opts, child });
    return child;
  };
}

test("Play starts the desktop emulator, records play time, and only from this computer", async () => {
  const { start } = await import("../../server/index.js");
  const root = tmpdir("phosphor-native-app-");
  const nativeRoot = tmpdir("phosphor-native-bin-");
  fs.mkdirSync(path.join(root, "ROMs", "GameCube"), { recursive: true });
  const gc = Buffer.alloc(0x10000); gc.writeUInt32BE(0xc2339f3d, 0x1c);
  fs.writeFileSync(path.join(root, "ROMs", "GameCube", "Homebrew Demo.iso"), gc);
  const calls = [];
  const exits = [];
  const n = new NativeEmulators({ bundledDir: path.join(nativeRoot, "b"), userDir: path.join(nativeRoot, "u"), platform: "linux", log: {} });
  await n.install("dolphin", await catalog.latestRelease(catalog.NATIVE.dolphin, "linux"), { root: path.join(nativeRoot, "b") });
  const app = await start({ root, port: 0, host: "127.0.0.1", scan: false, watch: false,
    native: { bundledDir: path.join(nativeRoot, "b"), userDir: path.join(nativeRoot, "u"), platform: "linux", spawn: fakeSpawn(calls), quickExit: 1, onExit: (e) => exits.push(e) } });
  try {
    await app.library.scan({ reason: "test" });
    const b = `http://127.0.0.1:${app.port}`;
    const H = { "x-profile": "1" };
    const games = await (await fetch(`${b}/api/games`, { headers: H })).json();
    assert.equal(games.length, 1);
    assert.equal(games[0].system, "gamecube");
    const launch = await (await fetch(`${b}/api/games/${games[0].id}/launch`, { headers: H })).json();
    assert.equal(launch.native.emulator, "Dolphin");
    assert.equal(launch.native.installed, true);
    const state = await (await fetch(`${b}/api/state`, { headers: H })).json();
    assert.equal(state.desktop, true);
    assert.equal(state.systems.find((s) => s.id === "gamecube").emulatorReady, true);
    const r = await fetch(`${b}/api/games/${games[0].id}/native`, { method: "POST", headers: H });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(calls.length, 1);
    assert.match(calls[0].program, /Dolphin_Emulator-2609a-anylinux-x86_64\.AppImage$/);
    assert.ok(calls[0].args.includes(path.join(root, "ROMs", "GameCube", "Homebrew Demo.iso")));
    assert.equal(calls[0].args[2], path.join(root, "Saves", "Player 1", "GameCube & Wii"), "saves in the player's folder");
    // A second game can't start while one is running.
    assert.equal((await fetch(`${b}/api/games/${games[0].id}/native`, { method: "POST", headers: H })).status, 409);
    await new Promise((res) => setTimeout(res, 1100));
    calls[0].child.emit("exit", 0);
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(exits.length, 1);
    assert.equal(exits[0].failed, false);
    const g = await (await fetch(`${b}/api/games/${games[0].id}`, { headers: H })).json();
    assert.ok(g.seconds >= 1, "play time recorded");
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(nativeRoot, { recursive: true, force: true });
  }
});
