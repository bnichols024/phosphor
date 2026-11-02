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

test("the updater can update and roll back one desktop emulator", async () => {
  const { Emulators } = await import("../../server/emulators.js");
  const root = tmpdir("phosphor-native-one-");
  const n = new NativeEmulators({ bundledDir: path.join(root, "bundled"), userDir: path.join(root, "user"), platform: "linux", log: {} });
  await n.install("flycast", await catalog.latestRelease(catalog.NATIVE.flycast, "linux"), { root: path.join(root, "bundled") });
  const emu = new Emulators({ bundledDir: null, userDir: path.join(root, "web"), native: n, log: {} });
  releases.flycast = "v2.9";
  try {
    const r = await emu.update({ only: { kind: "native", id: "flycast" } });
    assert.deepEqual([r.change.from, r.change.to], ["2.7", "2.9"]);
    assert.equal(n.active("flycast").version, "2.9");
    assert.equal(n.active("dolphin"), null, "only the one asked for");
    assert.equal(emu.summary().native.find((x) => x.id === "flycast").previous, "2.7");
    await emu.rollbackOne({ kind: "native", id: "flycast" });
    assert.equal(n.active("flycast").version, "2.7");
  } finally {
    releases.flycast = "v2.7";
    fs.rmSync(root, { recursive: true, force: true });
  }
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

// A minimal PARAM.SFO with string entries.
function makeSfo(entries) {
  const keys = Object.keys(entries);
  const keyBufs = keys.map((k) => Buffer.from(k + "\0"));
  const keyTableSize = keyBufs.reduce((n, b) => n + b.length, 0);
  const dataBufs = keys.map((k) => { const b = Buffer.alloc(Math.ceil((Buffer.byteLength(entries[k]) + 1) / 4) * 4); b.write(entries[k]); return b; });
  const keyTable = 20 + keys.length * 16, dataTable = keyTable + Math.ceil(keyTableSize / 4) * 4;
  const out = Buffer.alloc(dataTable + dataBufs.reduce((n, b) => n + b.length, 0));
  out.writeUInt32LE(0x46535000, 0); out.writeUInt32LE(0x101, 4); out.writeUInt32LE(keyTable, 8); out.writeUInt32LE(dataTable, 12); out.writeUInt32LE(keys.length, 16);
  let ko = 0, dOff = 0;
  keys.forEach((k, i) => {
    const e = 20 + i * 16;
    out.writeUInt16LE(ko, e); out.writeUInt16LE(0x0204, e + 2); out.writeUInt32LE(Buffer.byteLength(entries[k]) + 1, e + 4); out.writeUInt32LE(dataBufs[i].length, e + 8); out.writeUInt32LE(dOff, e + 12);
    keyBufs[i].copy(out, keyTable + ko); dataBufs[i].copy(out, dataTable + dOff);
    ko += keyBufs[i].length; dOff += dataBufs[i].length;
  });
  return out;
}

test("PS2, PS3, Xbox and Xbox 360 discs are told apart", async () => {
  const gamedb = new GameDB(path.join(import.meta.dirname, "..", "..", "db"));
  const dir = tmpdir("phosphor-discs2-");
  const iso = (name, sysId, extra) => {
    const b = Buffer.alloc(0x10000 + 2048);
    b.write("\x01CD001", 16 * 2048, "latin1"); b.write(sysId.padEnd(32), 16 * 2048 + 8, "latin1");
    if (extra) b.write(extra, 0x9000, "latin1");
    const p = path.join(dir, name); fs.writeFileSync(p, b); return p;
  };
  assert.equal((await identify(iso("Okami.iso", "PLAYSTATION", "BOOT2 = cdrom0:\\SLUS_215.15;1\nVER = 1.00"), { gamedb })).system, "ps2");
  assert.equal((await identify(iso("Crash.iso", "PLAYSTATION", "BOOT = cdrom:\\SCUS_949.00;1"), { gamedb })).system, "psx");
  assert.equal((await identify(iso("Demon.iso", "PS3VOLUME"), { gamedb })).system, "ps3");
  const xbox = Buffer.alloc(0x10000 + 64); xbox.write("MICROSOFT*XBOX*MEDIA", 0x10000);
  fs.writeFileSync(path.join(dir, "Halo.iso"), xbox);
  assert.equal((await identify(path.join(dir, "Halo.iso"), { gamedb })).system, "xbox");
  const fd = fs.openSync(path.join(dir, "Gears.iso"), "w");
  fs.writeSync(fd, Buffer.from("MICROSOFT*XBOX*MEDIA"), 0, 20, 0xfda0000); fs.closeSync(fd); // sparse
  assert.equal((await identify(path.join(dir, "Gears.iso"), { gamedb })).system, "xbox360");
  fs.writeFileSync(path.join(dir, "Mario Odyssey.nsp"), "PFS0");
  assert.equal((await identify(path.join(dir, "Mario Odyssey.nsp"), { gamedb })).system, "switch");
  fs.writeFileSync(path.join(dir, "Zelda.3ds"), Buffer.alloc(512));
  assert.equal((await identify(path.join(dir, "Zelda.3ds"), { gamedb })).system, "3ds");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("game folders (PS3, PS4, Vita, Wii U) are one game each, named from their own info", async () => {
  const gamedb = new GameDB(path.join(import.meta.dirname, "..", "..", "db"));
  const dir = tmpdir("phosphor-folders-");
  const put = (rel, data = "x") => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };
  put("Demons Souls [BLUS30443]/PS3_GAME/PARAM.SFO", makeSfo({ TITLE: "Demon's Souls", TITLE_ID: "BLUS30443" }));
  put("Demons Souls [BLUS30443]/PS3_GAME/USRDIR/EBOOT.BIN");
  put("Demons Souls [BLUS30443]/PS3_GAME/USRDIR/data/level1.bin");
  put("Bloodborne/eboot.bin"); put("Bloodborne/sce_sys/param.sfo", makeSfo({ TITLE: "Bloodborne", TITLE_ID: "CUSA00900" }));
  put("Gravity Rush/eboot.bin"); put("Gravity Rush/sce_sys/param.sfo", makeSfo({ TITLE: "Gravity Rush", TITLE_ID: "PCSA00011" }));
  put("Mario Kart 8/code/Turbo.rpx"); put("Mario Kart 8/code/other.rpx");
  put("Mario Kart 8/code/cos.xml", '<app><argstr type="string" length="4096">Turbo.rpx</argstr></app>');
  put("Mario Kart 8/meta/meta.xml", "<menu><longname_en type=\"string\">Mario Kart 8</longname_en></menu>");
  put("Mario Kart 8/content/data.bin");
  const all = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : all.push(p); } };
  walk(dir);
  const groups = await groupGames(all);
  const games = [];
  for (const g of groups) games.push({ g, id: await identify(g.main, { gamedb, folderGame: g.folder }) });
  const sum = games.map(({ g, id }) => [id.system, id.match?.name || id.title, path.basename(g.main)]).sort();
  assert.deepEqual(sum.map((x) => x[0]).sort(), ["ps3", "ps4", "vita", "wiiu"], "no stray .bin files become games");
  assert.match(sum.find((x) => x[0] === "ps3")[1], /Demon's Souls/);
  assert.equal(sum.find((x) => x[0] === "wiiu")[2], "Turbo.rpx", "cos.xml picks the program");
  assert.equal(sum.find((x) => x[0] === "ps4")[1], "Bloodborne");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("players' own files are recognised and passed to the emulators", async () => {
  const { detectSystemFiles } = await import("../../server/native/files.js");
  const dir = tmpdir("phosphor-sysfiles-");
  const put = (name, data) => { const p = path.join(dir, name); fs.writeFileSync(p, data); return { file: p, name: name.toLowerCase(), size: data.length }; };
  const ps2 = Buffer.alloc(4 * 1024 * 1024); ps2.write("RESET\0\0\0\0\0ROMDIR\0\0\0\0EXTINFO\0\0\0ROMVER", 0x2700, "latin1");
  const files = [put("SCPH-70012.bin", ps2), put("prod.keys", Buffer.from("header_key = 00")), put("mcpx_1.0.bin", Buffer.alloc(512)), put("Complex_4627.bin", Buffer.alloc(262144)), put("PS3UPDAT.PUP", Buffer.from("SCEUF"))];
  const det = await detectSystemFiles(files);
  assert.equal(det.ps2.ready, true);
  assert.equal(det.switch.ready, true);
  assert.equal(det.xbox.ready, true);
  assert.equal(path.basename(det.xbox.files.flash), "Complex_4627.bin");
  assert.equal(det.ps3.ready, true);
  assert.equal(det.vita.ready, false);
  assert.equal((await detectSystemFiles([files[0]].map((f) => ({ ...f, name: "random.bin" })).concat([{ ...files[0], file: path.join(dir, "nope"), name: "x.bin", size: 5 }]))).ps2.ready, true);

  const { NATIVE } = catalog;
  const data = path.join(dir, "data"), saves = path.join(dir, "saves");
  // PCSX2 gets the BIOS folder and per-player memory cards, and skips its setup wizard.
  const p = NATIVE.pcsx2.launch({ game: "/g/Okami.iso", saveDir: saves, dataDir: data, sysFiles: det.ps2.files });
  assert.deepEqual(p.args.slice(-2), ["--", "/g/Okami.iso"]);
  const ini = fs.readFileSync(path.join(data, "PCSX2", "inis", "PCSX2.ini"), "utf8");
  assert.match(ini, /SetupWizardIncomplete = false/);
  assert.match(ini, new RegExp(`BIOS = SCPH-70012\\.bin`));
  assert.ok(ini.includes(`MemoryCards = ${saves}`));
  // Eden reads the player's keys from its keys folder.
  const e = NATIVE.eden.launch({ game: "/g/Zelda.nsp", saveDir: saves, dataDir: data, platform: "linux", sysFiles: det.switch.files });
  assert.ok(fs.existsSync(path.join(e.env.XDG_DATA_HOME, "eden", "keys", "prod.keys")));
  assert.deepEqual(e.args, ["-f", "-g", "/g/Zelda.nsp"]);
  // xemu: config with the player's BIOS files and a blank hard drive of their own.
  const x = await NATIVE.xemu.launch({ game: "/g/Halo.iso", saveDir: saves, dataDir: data, platform: "linux", sysFiles: det.xbox.files });
  const toml = fs.readFileSync(path.join(data, "xemu.toml"), "utf8");
  assert.ok(toml.includes("mcpx_1.0.bin") && toml.includes("Complex_4627.bin"));
  assert.ok(fs.statSync(path.join(saves, "xbox_hdd.qcow2")).size > 1000, "blank hard drive copied");
  assert.ok(x.args.includes("-full-screen"));
  // RPCS3 installs Sony's firmware once, headless, before the first game.
  const steps = NATIVE.rpcs3.prepare({ dataDir: data, sysFiles: det.ps3.files });
  assert.deepEqual(steps[0].args.slice(0, 2), ["--headless", "--installfw"]);
  fs.writeFileSync(steps[0].marker, "done");
  assert.equal(NATIVE.rpcs3.prepare({ dataDir: data, sysFiles: det.ps3.files }).length, 0, "only once");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("desktop consoles that need the player's files show locked until those files are dropped in", async () => {
  const { start } = await import("../../server/index.js");
  const root = tmpdir("phosphor-locks-");
  const app = await start({ root, port: 0, host: "127.0.0.1", scan: false, watch: false });
  try {
    const b = `http://127.0.0.1:${app.port}`;
    const sys = async (id) => (await (await fetch(`${b}/api/state`)).json()).systems.find((s) => s.id === id);
    const sw = await sys("switch");
    assert.equal(sw.locked, true);
    assert.equal(sw.needs.chip, "Needs keys");
    assert.ok(fs.existsSync(path.join(root, "ROMs", "Switch")), "its folder exists so games can be added already");
    assert.equal((await sys("3ds")).locked, false, "3DS needs nothing");
    fs.writeFileSync(path.join(root, "Drop Games Here", "prod.keys"), "header_key = 00\n");
    await app.library.scan({ reason: "test" });
    assert.ok(fs.existsSync(path.join(root, "BIOS", "prod.keys")), "keys filed into the BIOS folder");
    assert.equal((await sys("switch")).locked, false);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Switch 2 (Eglantine): newest pre-release build, unpacked game folders, its own data folder", async () => {
  // Eglantine only publishes numbered pre-releases; the newest one with this OS's build wins.
  const gh = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/repos/Djihads80/Eglantine/releases?")) return res.end(JSON.stringify([
      { tag_name: "build-99", prerelease: true, assets: [{ name: `eglantine-windows-x86_64-${"a".repeat(40)}.zip`, browser_download_url: "x", size: 1 }] },
      { tag_name: "build-98", prerelease: true, assets: [{ name: `eglantine-${"b".repeat(40)}-linux-x86_64.AppImage`, browser_download_url: "y", size: 1 },
        { name: `eglantine-${"b".repeat(40)}-linux-x86_64-pgo.AppImage`, browser_download_url: "z", size: 1 }] },
    ]));
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => gh.listen(0, "127.0.0.1", r));
  const old = process.env.PHOSPHOR_GITHUB_API;
  process.env.PHOSPHOR_GITHUB_API = `http://127.0.0.1:${gh.address().port}`;
  try {
    const { NATIVE, latestRelease } = catalog;
    assert.equal((await latestRelease(NATIVE.eglantine, "win32")).version, "build-99");
    const lin = await latestRelease(NATIVE.eglantine, "linux");
    assert.deepEqual([lin.version, lin.url], ["build-98", "y"], "skips a release without a Linux build, and the PGO variant");
  } finally { process.env.PHOSPHOR_GITHUB_API = old; gh.close(); }

  // Unpacked games: exefs/main + main.npdm; the program ID tells Switch 2 from Switch.
  const gamedb = new GameDB(path.join(import.meta.dirname, "..", "..", "db"));
  const dir = tmpdir("phosphor-ns2-");
  const npdm = (id) => { const b = Buffer.alloc(0x200); b.write("META", 0); b.writeUInt32LE(0x80, 0x70); b.write("ACI0", 0x80); b.writeBigUInt64LE(id, 0x90); return b; };
  const put = (rel, data = "x") => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };
  put("Mario Kart World [0400C3F00006E000]/exefs/main"); put("Mario Kart World [0400C3F00006E000]/exefs/main.npdm", npdm(0x0400c3f00006e000n));
  put("Mario Kart World [0400C3F00006E000]/exefs/sdk"); put("Mario Kart World [0400C3F00006E000]/romfs/data.bin");
  put("Old Game/exefs/main"); put("Old Game/exefs/main.npdm", npdm(0x0100000000010000n));
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } };
  walk(dir);
  const groups = await groupGames(files);
  assert.equal(groups.length, 2, "one game per folder, no stray files");
  const ids = [];
  for (const g of groups) ids.push(await identify(g.main, { gamedb, folderGame: g.folder }));
  const mk = ids.find((i) => i.system === "switch2");
  assert.ok(mk, "Switch 2 title recognised");
  assert.equal(mk.title, "Mario Kart World");
  assert.equal(ids.find((i) => i.title === "Old Game").system, "switch");

  // Windows: portable "user" folder next to the program, linked to the player's own folder, so
  // Eglantine never shares Eden's settings; keys go there.
  const prog = path.join(dir, "bin", "eglantine.exe");
  put("bin/eglantine.exe");
  const keys = put("prod.keys", "header_key = 00");
  const data = path.join(dir, "player1");
  const r = NATIVE_launch(catalog.NATIVE.eglantine, { game: mk.files[0], dataDir: data, saveDir: data, platform: "win32", program: prog, sysFiles: { prodKeys: keys } });
  assert.deepEqual(r.args, ["-f", "-g", mk.files[0]]);
  assert.equal(fs.realpathSync(path.join(dir, "bin", "user")), fs.realpathSync(path.join(data, "user")));
  assert.ok(fs.existsSync(path.join(data, "user", "keys", "prod.keys")));
  fs.rmSync(dir, { recursive: true, force: true });
});
const NATIVE_launch = (emu, ctx) => emu.launch(ctx);

test("Settings › Graphics reaches the emulators; Open settings starts an emulator without a game", async () => {
  const { NATIVE } = catalog;
  const d = tmpdir("phosphor-gfx-");
  const g = { scale: 3, widescreen: true, fps: true, vsync: false };
  const dol = NATIVE.dolphin.launch({ game: "/g/x.iso", saveDir: d, dataDir: d, platform: "linux", graphics: g });
  for (const want of ["GFX.Settings.InternalResolution=3", "GFX.Settings.wideScreenHack=True", "GFX.Settings.ShowFPS=True", "GFX.Hardware.VSync=False"]) assert.ok(dol.args.includes(want), want);
  assert.ok(NATIVE.flycast.launch({ game: "/g/x.cdi", saveDir: d, dataDir: d, graphics: g }).args.includes("config:rend.Resolution=1440"));
  NATIVE.pcsx2.launch({ game: "/g/x.iso", saveDir: d, dataDir: d, graphics: g });
  const ini = fs.readFileSync(path.join(d, "PCSX2", "inis", "PCSX2.ini"), "utf8");
  assert.match(ini, /upscale_multiplier = 3/);
  assert.match(ini, /EnableWideScreenPatches = true/);
  const none = NATIVE.dolphin.launch({ game: "/g/x.iso", saveDir: d, dataDir: d, platform: "linux", graphics: null });
  assert.ok(!none.args.some((a) => a.startsWith("GFX.")), "'use the emulator's own settings' leaves them alone");
  // Configure mode: Dolphin's main window with the player's folder, no game, no batch mode.
  const cfg = NATIVE.dolphin.configure({ saveDir: d, dataDir: d, platform: "linux" });
  assert.deepEqual(cfg.args.slice(0, 2), ["-u", d]);
  assert.ok(!cfg.args.includes("-b") && !cfg.args.includes("-e"));
  assert.equal(NATIVE.shadps4.configure, undefined, "no settings window to open");
  const calls = [];
  const { NativeRunner } = await import("../../server/native/runner.js");
  const n = new NativeEmulators({ bundledDir: path.join(d, "b"), userDir: path.join(d, "u"), platform: "linux", log: {} });
  await n.install("dolphin", await catalog.latestRelease(catalog.NATIVE.dolphin, "linux"), { root: path.join(d, "b") });
  const exits = [];
  const r = new NativeRunner({ native: n, log: {}, spawnFn: fakeSpawn(calls), onExit: (e) => exits.push(e) });
  await r.start({ emulatorId: "dolphin", configure: true, game: null, saveDir: d, dataDir: d, profileId: 1 });
  assert.ok(!calls[0].args.includes("-e"));
  calls[0].child.emit("exit", 0);
  assert.equal(exits[0].failed, false, "closing a settings window quickly isn't a failure");
  fs.rmSync(d, { recursive: true, force: true });
});
