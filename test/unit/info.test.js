import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { start } from "../../server/index.js";
import { raHash } from "../../server/achievements.js";
import { tmpdir, nesRom } from "./helpers.js";

// One fake server playing Wikipedia, RetroAchievements and ScreenScraper.
let fake, fakeBase, app, base, root;
const rom = nesRom();
const romHash = crypto.createHash("md5").update(rom.subarray(16)).digest("hex");
let ssOn = false;

before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    if (u.pathname === "/w/api.php") return send({ query: { search: [{ title: "Super Mario Bros. (film)" }, { title: "Super Mario Bros." }] } });
    if (u.pathname === "/api/rest_v1/page/summary/Super_Mario_Bros._(film)") return send({ type: "standard", description: "1993 film", extract: "A movie." });
    if (u.pathname === "/api/rest_v1/page/summary/Super_Mario_Bros.") return send({ type: "standard", description: "1985 video game", extract: "Super Mario Bros. is a platform game.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Super_Mario_Bros." } } });
    if (u.pathname === "/API/API_GetUserProfile.php") return u.searchParams.get("y") === "goodkey" ? send({ User: "Bryan", TotalPoints: 1234, UserPic: "/UserPic/Bryan.png" }) : (res.statusCode = 401, res.end("{}"));
    if (u.pathname === "/API/API_GetGameList.php") return send([{ ID: 1446, Title: "Super Mario Bros.", Hashes: [romHash] }]);
    if (u.pathname === "/API/API_GetGameInfoAndUserProgress.php") return send({ Title: "Super Mario Bros.", ImageIcon: "/Images/1.png", Achievements: {
      1: { ID: 1, Title: "First steps", Description: "Beat 1-1", Points: 5, BadgeName: "100", DisplayOrder: 1, DateEarned: "2024-01-02 10:00:00" },
      2: { ID: 2, Title: "Warp zone", Description: "Find a warp", Points: 10, BadgeName: "101", DisplayOrder: 2 },
    } });
    if (u.pathname === "/ss/ssuserInfos.php") return u.searchParams.get("devid") === "dev" ? send({ response: { ssuser: {} } }) : (res.statusCode = 403, res.end("Erreur de login : Vérifier vos identifiants développeur !"));
    if (u.pathname === "/ss/jeuInfos.php") return ssOn ? send({ response: { jeu: { id: "1", synopsis: [{ langue: "fr", text: "Un jeu." }, { langue: "en", text: "Mario saves the princess." }], note: { text: "16" },
      medias: [{ type: "video-normalized", region: "wor", url: `${fakeBase}/vid.mp4` }] } } }) : (res.statusCode = 404, res.end("Erreur : Jeu non trouvée !"));
    if (u.pathname === "/vid.mp4") { res.setHeader("content-type", "video/mp4"); return res.end(Buffer.alloc(2048, 1)); }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  fakeBase = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, { PHOSPHOR_THUMBS: "http://127.0.0.1:9", PHOSPHOR_WIKIPEDIA_URL: fakeBase, PHOSPHOR_RA_URL: fakeBase, PHOSPHOR_SCREENSCRAPER_URL: `${fakeBase}/ss` });
  root = tmpdir("phosphor-info-");
  fs.mkdirSync(path.join(root, "ROMs", "NES"), { recursive: true });
  fs.writeFileSync(path.join(root, "ROMs", "NES", "Super Mario Bros. (World).nes"), rom);
  app = await start({ root, port: 0, host: "127.0.0.1", scan: false, watch: false });
  base = `http://127.0.0.1:${app.port}`;
  await app.library.scan({ reason: "test" });
});
after(async () => { await app.close(); fake.close(); fs.rmSync(root, { recursive: true, force: true }); });

const j = async (url, opts = {}) => {
  const r = await fetch(base + url, { ...opts, headers: { "x-profile": "1", "content-type": "application/json", ...(opts.headers || {}) } });
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.arrayBuffer() };
};
const waitFor = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };

test("RetroAchievements hashes follow rcheevos rules", () => {
  assert.equal(raHash("nes", rom), romHash, "iNES header is skipped");
  const z64 = Buffer.from([0x80, 0x37, 0x12, 0x40, 1, 2, 3, 4]);
  const v64 = Buffer.from([0x37, 0x80, 0x40, 0x12, 2, 1, 4, 3]);
  assert.equal(raHash("n64", v64), raHash("n64", z64), "byte-swapped N64 ROMs hash like big-endian ones");
});

test("descriptions come from the right Wikipedia article", async () => {
  const id = (await j("/api/games")).body[0].id;
  const g = await waitFor(async () => { const d = (await j(`/api/games/${id}`)).body; return d.description ? d : null; });
  assert.ok(g, "description arrived");
  assert.equal(g.description, "Super Mario Bros. is a platform game.", "the film article was skipped");
  assert.equal(g.descSource, "Wikipedia");
});

test("RetroAchievements: link an account, then see the game's achievements and progress", async () => {
  const id = (await j("/api/games")).body[0].id;
  assert.equal((await j(`/api/games/${id}/achievements`)).body.connected, false);
  assert.equal((await j("/api/retroachievements", { method: "PUT", body: JSON.stringify({ user: "bryan", key: "badkey" }) })).status, 400);
  const linked = await j("/api/retroachievements", { method: "PUT", body: JSON.stringify({ user: "bryan", key: "goodkey" }) });
  assert.equal(linked.body.user, "Bryan");
  const a = (await j(`/api/games/${id}/achievements`)).body;
  assert.equal(a.found, true);
  assert.equal(a.total, 2);
  assert.equal(a.earned, 1);
  assert.equal(a.earnedPoints, 5);
  assert.equal((await j("/api/retroachievements")).body.key, undefined, "the API key never goes back to the browser");
});

test("ScreenScraper: bad developer login is refused; a good one fetches description, rating and video", async () => {
  const id = (await j("/api/games")).body[0].id;
  const bad = await j("/api/screenscraper", { method: "PUT", body: JSON.stringify({ devid: "nope", devpassword: "x" }) });
  assert.equal(bad.status, 400);
  assert.equal((await j("/api/screenscraper")).body.ready, false, "bad credentials aren't kept");
  ssOn = true;
  const good = await j("/api/screenscraper", { method: "PUT", body: JSON.stringify({ devid: "dev", devpassword: "pw" }) });
  assert.equal(good.body.ready, true);
  const g = await waitFor(async () => { const d = (await j(`/api/games/${id}`)).body; return d.descSource === "ScreenScraper" ? d : null; });
  assert.ok(g, "ScreenScraper info arrived");
  assert.equal(g.description, "Mario saves the princess.", "English synopsis chosen");
  assert.equal(g.rating, 4, "16/20 shown as 4 out of 5");
  const v = await fetch(base + g.video);
  assert.equal(v.status, 200);
  assert.equal((await v.arrayBuffer()).byteLength, 2048);
});
