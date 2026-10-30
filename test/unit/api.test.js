import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { start } from "../../server/index.js";
import { tmpdir, nesRom, genesisRom, makeZip } from "./helpers.js";

let app, base, root;
const H = { "x-profile": "1" };

before(async () => {
  root = tmpdir("phosphor-api-");
  // Offline: point art lookups at a closed port so tests never touch the network.
  process.env.PHOSPHOR_THUMBS = "http://127.0.0.1:9";
  app = await start({ root, port: 0, host: "127.0.0.1", scan: false, watch: false });
  base = `http://127.0.0.1:${app.port}`;
});
after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });

const j = async (url, opts = {}) => {
  const r = await fetch(base + url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const body = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.arrayBuffer();
  return { status: r.status, body };
};

test("fresh install has a player, every console and the folder layout", async () => {
  const { body } = await j("/api/state");
  assert.equal(body.profiles.length, 1);
  assert.equal(body.systems.length, 29, "29 consoles ready, each with its BIOS included or not needed");
  assert.ok(fs.existsSync(path.join(root, "ROMs", "SNES")));
  assert.ok(fs.existsSync(path.join(root, "Drop Games Here")));
  assert.ok(fs.existsSync(path.join(root, "README.txt")));
  assert.equal(body.systems.find((s) => s.id === "segacd"), undefined, "consoles needing a copyrighted BIOS are left out");
  assert.ok(body.hiddenSystems.some((s) => s.id === "segacd"));
  assert.ok(!fs.existsSync(path.join(root, "ROMs", "Sega CD")), "and get no folder");
  assert.ok(body.systems.find((s) => s.id === "psx"), "PlayStation needs no BIOS file");
});

test("uploads land in the drop folder and get sorted into the right console", async () => {
  for (const [name, data] of [["Cool Game.nes", nesRom()], ["Hedgehog.bin", genesisRom()], ["folder/Zipped (USA).zip", makeZip({ "Zipped (USA).gba": Buffer.alloc(4096, 7) })], ["notes.txt", "hi"]]) {
    const r = await fetch(`${base}/api/upload?path=${encodeURIComponent(name)}`, { method: "PUT", body: data, headers: H });
    assert.equal(r.status, 201);
  }
  const scan = await app.library.scan({ reason: "test" });
  assert.equal(scan.total, 3);
  assert.ok(fs.existsSync(path.join(root, "ROMs", "NES", "Cool Game.nes")));
  assert.ok(fs.existsSync(path.join(root, "ROMs", "Genesis", "Hedgehog.bin")));
  assert.ok(fs.existsSync(path.join(root, "ROMs", "Game Boy Advance", "Zipped (USA).zip")));
  const games = (await j("/api/games")).body;
  assert.deepEqual(games.map((g) => g.system).sort(), ["gba", "genesis", "nes"]);
});

test("renamed files keep their play history", async () => {
  const g = (await j("/api/games?system=nes")).body[0];
  await j(`/api/games/${g.id}/favorite`, { method: "POST", body: JSON.stringify({ favorite: true }), headers: { "content-type": "application/json" } });
  fs.renameSync(path.join(root, "ROMs", "NES", "Cool Game.nes"), path.join(root, "ROMs", "NES", "Cool Game Renamed.nes"));
  await app.library.scan({ reason: "test" });
  const after = (await j("/api/games?system=nes")).body;
  assert.equal(after.length, 1);
  assert.equal(after[0].id, g.id);
  assert.equal(after[0].favorite, true);
});

test("launch info, in-game saves (with history) and save states round-trip", async () => {
  const g = (await j("/api/games?system=nes")).body[0];
  const launch = (await j(`/api/games/${g.id}/launch`)).body;
  assert.equal(launch.core, "fceumm");
  assert.match(launch.gameUrl, /\.nes$/);
  const rom = await fetch(base + launch.gameUrl);
  assert.equal(rom.status, 200);
  assert.equal((await rom.arrayBuffer()).byteLength, nesRom().length);

  for (const fill of [1, 2]) {
    const r = await j(`/api/games/${g.id}/save?ext=srm`, { method: "PUT", body: Buffer.alloc(8192, fill) });
    assert.equal(r.status, 200);
  }
  const save = await j(`/api/games/${g.id}/save`);
  assert.equal(new Uint8Array(save.body)[0], 2);
  const hist = (await j(`/api/games/${g.id}/save/history`)).body;
  assert.equal(hist.length, 1, "previous save kept");
  assert.ok(fs.readdirSync(path.join(root, "Saves", "Player 1", "NES")).some((f) => f.endsWith(".srm")));

  assert.equal((await j(`/api/games/${g.id}/states/0`, { method: "PUT", body: Buffer.alloc(1000, 9), headers: { "x-core": "fceumm" } })).status, 200);
  const states = (await j(`/api/games/${g.id}/states`)).body;
  assert.deepEqual(states.map((s) => s.slot), [0]);
  const back = await j(`/api/games/${g.id}/states/0`);
  assert.equal(back.body.byteLength, 1000);

  const s = (await j(`/api/games/${g.id}/start`, { method: "POST" })).body;
  await j(`/api/sessions/${s.session}`, { method: "POST", body: JSON.stringify({ seconds: 95 }), headers: { "content-type": "application/json" } });
  const detail = (await j(`/api/games/${g.id}`)).body;
  assert.equal(detail.seconds, 95);
  assert.equal(detail.playCount, 1);
  const home = (await j("/api/home")).body;
  assert.equal(home.recent[0].id, g.id);
  assert.equal(home.recent[0].resumable, true);
});

test("players have separate saves", async () => {
  const p2 = (await j("/api/profiles", { method: "POST", body: JSON.stringify({ name: "Sam" }), headers: { "content-type": "application/json" } })).body;
  const g = (await j("/api/games?system=nes")).body[0];
  const r = await fetch(`${base}/api/games/${g.id}/save`, { headers: { "x-profile": String(p2.id) } });
  assert.equal(r.status, 404);
  const fav = await (await fetch(`${base}/api/games?system=nes`, { headers: { "x-profile": String(p2.id) } })).json();
  assert.equal(fav[0].favorite, false);
});

test("BIOS files dropped anywhere are recognised and unlock their console", async () => {
  // A fake file can't match a real BIOS checksum, so check the name path and the status shape.
  fs.writeFileSync(path.join(root, "BIOS", "syscard3.pce"), Buffer.alloc(262144));
  const bios = (await j("/api/bios")).body;
  assert.equal(bios.pcecd.ready, true);
  assert.equal(bios.pcecd.files[0].verified, false);
  assert.equal(bios.segacd.ready, false);
  await app.library.scan({ reason: "test" });
  const st = (await j("/api/state")).body;
  assert.ok(st.systems.some((s) => s.id === "pcecd"), "adding the BIOS makes the console appear");
  assert.ok(fs.existsSync(path.join(root, "ROMs", "TurboGrafx-CD")), "with its folder");
});

test("multi-disc games launch as one playlist with every disc attached", async () => {
  const dir = path.join(root, "ROMs", "PlayStation", "Epic");
  fs.mkdirSync(dir, { recursive: true });
  for (const n of [1, 2]) {
    fs.writeFileSync(path.join(dir, `Epic (USA) (Disc ${n}).bin`), Buffer.alloc(4096));
    fs.writeFileSync(path.join(dir, `Epic (USA) (Disc ${n}).cue`), `FILE "Epic (USA) (Disc ${n}).bin" BINARY\n  TRACK 01 MODE2/2352\n`);
  }
  await app.library.scan({ reason: "test" });
  const g = (await j("/api/games?system=psx")).body[0];
  assert.equal(g.discs, 2);
  const launch = (await j(`/api/games/${g.id}/launch`)).body;
  assert.match(launch.gameUrl, /\.m3u$/);
  assert.deepEqual(Object.keys(launch.externalFiles).sort(), ["/Epic (USA) (Disc 1).bin", "/Epic (USA) (Disc 1).cue", "/Epic (USA) (Disc 2).bin", "/Epic (USA) (Disc 2).cue", "/scph5501.bin"]);
  assert.equal(launch.externalFiles["/scph5501.bin"], "/bios-included/openbios.bin", "PlayStation gets the bundled OpenBIOS");
  const m3u = await (await fetch(base + launch.gameUrl)).text();
  assert.equal(m3u, "Epic (USA) (Disc 1).cue\nEpic (USA) (Disc 2).cue\n");
});

test("GBA games get the bundled open-source BIOS, and BIOS files in ROM folders move to BIOS/", async () => {
  fs.mkdirSync(path.join(root, "ROMs", "Arcade"), { recursive: true });
  fs.writeFileSync(path.join(root, "ROMs", "Arcade", "neogeo.zip"), makeZip({ "sp-s2.sp1": Buffer.alloc(64) }));
  await app.library.scan({ reason: "test" });
  assert.ok(fs.existsSync(path.join(root, "BIOS", "neogeo.zip")), "neogeo.zip moved to BIOS");
  assert.equal((await j("/api/games?system=arcade")).body.length, 0, "and isn't listed as a game");
  const gba = (await j("/api/games?system=gba")).body[0];
  const launch = (await j(`/api/games/${gba.id}/launch`)).body;
  assert.equal(launch.externalFiles["/gba_bios.bin"], "/bios-included/gba_bios.bin");
  const bios = await fetch(base + "/bios-included/gba_bios.bin");
  assert.equal(bios.status, 200);
  assert.equal((await bios.arrayBuffer()).byteLength, 16384);
  const st = (await j("/api/state")).body;
  assert.equal(st.systems.find((s) => s.id === "gba").bios, "included");
  assert.equal(st.systems.find((s) => s.id === "psx").bios, "included");
  assert.equal(st.systems.find((s) => s.id === "nds").bios, "builtin");
  assert.equal(st.systems.find((s) => s.id === "segacd"), undefined);
});

test("kid mode limits consoles, and the parent PIN guards it", async () => {
  const kid = (await j("/api/profiles", { method: "POST", body: JSON.stringify({ name: "Kiddo" }), headers: { "content-type": "application/json" } })).body;
  await j(`/api/profiles/${kid.id}`, { method: "PATCH", body: JSON.stringify({ settings: { kid: true, systems: ["nes"] } }), headers: { "content-type": "application/json" } });
  const games = await (await fetch(`${base}/api/games`, { headers: { "x-profile": String(kid.id) } })).json();
  assert.ok(games.length > 0 && games.every((g) => g.system === "nes"));
  const st = await (await fetch(`${base}/api/state`, { headers: { "x-profile": String(kid.id) } })).json();
  assert.deepEqual(st.systems.map((s) => s.id), ["nes"]);
  assert.equal(st.settings.hasPin, false);
  const post = (u, b) => j(u, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
  assert.equal((await post("/api/parent/pin", { pin: "1234" })).status, 200);
  assert.equal((await post("/api/parent/check", { pin: "0000" })).body.ok, false);
  assert.equal((await post("/api/parent/check", { pin: "1234" })).body.ok, true);
  assert.equal((await post("/api/parent/pin", { pin: "9999", current: "0000" })).status, 403, "changing needs the current PIN");
  assert.equal((await j("/api/state")).body.settings.parentPin, undefined, "the PIN never leaves the server");
});
