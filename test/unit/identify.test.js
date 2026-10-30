import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { identify } from "../../server/identify.js";
import { GameDB, parseName, normTitle } from "../../server/gamedb.js";
import { groupGames } from "../../server/library.js";
import { listZip, readZipEntry } from "../../server/lib/zip.js";
import { readTar } from "../../server/lib/tar.js";
import { systemForFolder } from "../../server/systems.js";
import { tmpdir, makeZip, makeTar, nesRom, genesisRom, rawDisc } from "./helpers.js";

const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "db");
const gamedb = new GameDB(dbDir);
const dir = tmpdir();
const put = (name, data) => { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };

test("parseName pulls title, region and tags out of No-Intro names", () => {
  assert.deepEqual(parseName("Super Mario World (USA)"), { title: "Super Mario World", region: "US", tags: [], disc: null });
  const z = parseName("Legend of Zelda, The - A Link to the Past (Europe) (Rev 1).sfc");
  assert.equal(z.title, "The Legend of Zelda - A Link to the Past");
  assert.equal(z.region, "EU");
  assert.deepEqual(z.tags, ["Rev 1"]);
  assert.equal(parseName("Final Fantasy VII (USA) (Disc 2)").disc, 2);
  assert.equal(parseName("Sonic (USA, Europe)").region, "World");
  assert.equal(parseName("Contra (U) [!]").region, "US");
  assert.equal(normTitle("The Legend of Zelda: A Link to the Past"), normTitle("Legend of Zelda, The - A Link to the Past"));
});

test("folder names from other frontends map to systems", () => {
  assert.equal(systemForFolder("snes"), "snes");
  assert.equal(systemForFolder("Super Nintendo"), "snes");
  assert.equal(systemForFolder("megadrive"), "genesis");
  assert.equal(systemForFolder("psx"), "psx");
  assert.equal(systemForFolder("PlayStation"), "psx");
  assert.equal(systemForFolder("Game Boy Advance"), "gba");
  assert.equal(systemForFolder("holiday photos"), null);
});

test("unique extensions identify the system", async () => {
  const r = await identify(put("a/Some Game.nes", nesRom()), { gamedb });
  assert.equal(r.system, "nes");
  assert.equal(r.reason, "extension");
  assert.match(r.crc, /^[0-9A-F]{8}$/);
});

test("ambiguous .bin is sniffed by its header", async () => {
  assert.equal((await identify(put("b/sonic.bin", genesisRom()), { gamedb })).system, "genesis");
  assert.equal((await identify(put("b/pitfall.bin", Buffer.alloc(4096, 1)), { gamedb })).system, "atari2600");
});

test("zipped cartridges are identified from the zip's file list", async () => {
  const zip = put("c/mario.zip", makeZip({ "Super Mario (USA).sfc": Buffer.alloc(512 * 1024, 3) }));
  const r = await identify(zip, { gamedb });
  assert.equal(r.system, "snes");
  assert.equal(r.reason, "zip contents");
  const entries = await listZip(zip);
  assert.equal(entries.length, 1);
  assert.equal((await readZipEntry(zip, entries[0], 16)).length, 16);
});

test("arcade sets are recognised by FBNeo set name", async () => {
  const r = await identify(put("d/sf2.zip", makeZip({ "sf2_30a.bin": Buffer.alloc(100) })), { gamedb, arcadeHint: true });
  assert.equal(r.system, "arcade");
  assert.match(r.match.name, /Street Fighter II/);
});

test("disc images are told apart by their headers", async () => {
  const sega = put("e/Sonic CD.bin", rawDisc("SEGADISCSYSTEM  "));
  put("e/Sonic CD.cue", 'FILE "Sonic CD.bin" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\n');
  assert.equal((await identify(path.join(dir, "e/Sonic CD.cue"), { gamedb })).system, "segacd");
  assert.equal((await identify(put("e/nights.bin", rawDisc("SEGA SEGASATURN ")), { gamedb })).system, "saturn");
  assert.equal((await identify(put("e/ff7.bin", rawDisc(null, { pvdSystem: "PLAYSTATION" })), { gamedb })).system, "psx");
  assert.ok(fs.existsSync(sega));
});

test("cue sheets own their tracks, and discs 1..n become one game", async () => {
  const d = path.join(dir, "f");
  for (const n of [1, 2]) {
    put(`f/Epic (USA) (Disc ${n}).bin`, rawDisc(null, { pvdSystem: "PLAYSTATION" }));
    put(`f/Epic (USA) (Disc ${n}).cue`, `FILE "Epic (USA) (Disc ${n}).bin" BINARY\n  TRACK 01 MODE2/2352\n`);
  }
  put("f/Other (USA).chd", Buffer.alloc(64));
  const files = fs.readdirSync(d).map((f) => path.join(d, f));
  const groups = await groupGames(files);
  assert.equal(groups.length, 2);
  const epic = groups.find((g) => g.discs === 2);
  assert.ok(epic, "multi-disc game grouped");
  assert.equal(epic.files.length, 4);
  assert.match(epic.main, /Disc 1\)\.cue$/);
});

test("tar reader handles npm-style tarballs", () => {
  const entries = readTar(makeTar({ "package/data/loader.js": "hello", "package/README.md": "x" }));
  assert.deepEqual(entries.map((e) => e.name), ["package/data/loader.js", "package/README.md"]);
  assert.equal(entries[0].data.toString(), "hello");
});

test("PSP and PlayStation eboots, and PlayStation .exe programs, are told apart", async () => {
  const pspPbp = Buffer.alloc(0x40000); pspPbp.write("\0PBP", 0, "latin1");
  assert.equal((await identify(put("g/Homebrew.pbp", pspPbp), { gamedb })).system, "psp");
  const ps1Pbp = Buffer.alloc(0x40000); ps1Pbp.write("\0PBP", 0, "latin1"); ps1Pbp.write("PSISOIMG0000", 0x1000, "latin1");
  assert.equal((await identify(put("g/Classic.pbp", ps1Pbp), { gamedb })).system, "psx");
  const psxExe = Buffer.alloc(4096); psxExe.write("PS-X EXE", 0, "latin1");
  assert.equal((await identify(put("g/demo.exe", psxExe), { gamedb })).system, "psx");
  assert.equal((await identify(put("g/game.exe", Buffer.from("MZ\x90\0" + "x".repeat(100))), { gamedb })).system, "dos");
});
