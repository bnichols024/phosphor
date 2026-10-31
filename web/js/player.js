// The game screen: boots EmulatorJS with the right core, syncs in-game saves with the server,
// resumes exactly where you left off, and adds Phosphor's own menu, save slots, display filters,
// play-time tracking and phone controllers.
import { icon } from "./icons.js";
import qrcode from "/vendor/qrcode.mjs";

const gameId = Number(location.pathname.split("/")[2]);
const params = new URLSearchParams(location.search);
const profileId = localStorage.getItem("phosphor.profile");
const H = profileId ? { "x-profile": profileId } : {};
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else if (k === "class") e.className = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
};
const ic = (n) => { const t = document.createElement("template"); t.innerHTML = icon(n); return t.content.firstChild; };

// Every AudioContext the emulator creates, so the first tap or key press can unmute them all.
const audioCtxs = new Set();
{
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const Tracked = class extends AC { constructor(...a) { super(...a); audioCtxs.add(this); } };
    window.AudioContext = Tracked;
    window.webkitAudioContext = Tracked;
  }
}

// Keep each WebGL frame readable after it's shown, so clips and canvas captures aren't black.
{
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/.test(type)) attrs = { ...(attrs || {}), preserveDrawingBuffer: true };
    return getContext.call(this, type, attrs);
  };
}

const REWIND_OK = new Set(["nes", "snes", "gb", "gbc", "gba", "sms", "genesis", "gamegear", "sg1000", "pce", "ngp", "wonderswan", "atari2600", "atari5200", "atari7800", "vb", "coleco", "lynx", "c64", "c128", "vic20", "plus4", "pet", "zxspectrum", "zx81", "cpc"]);
const FILTERS = [
  { id: "sharp", name: "Pixel perfect", desc: "Crisp, exactly as drawn", shader: "disabled" },
  { id: "smooth", name: "Smooth", desc: "Softened pixel edges", shader: "2xScaleHQ.glslp" },
  { id: "crt", name: "CRT", desc: "Scanlines like an old TV", shader: "crt-easymode.glslp" },
  { id: "crt-curved", name: "Curved CRT", desc: "Curved glass and glow", shader: "crt-geom.glslp" },
  { id: "lcd", name: "Handheld LCD", desc: "Pixel grid like a Game Boy screen", shader: "disabled", lcd: true },
];
const HANDHELD = new Set(["gb", "gbc", "gba", "gamegear", "ngp", "wonderswan", "lynx", "nds", "psp"]);

let L = null; // launch info
let emu = null; // window.EJS_emulator once started
let started = false;
let sessionId = null;
let playSeconds = 0;
let lastSaveHash = null;
let menuOpen = false;
let quitting = false;
let padHost = null;
const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
if (isTouch) document.body.classList.add("touch");

// ---------------- boot ----------------
async function boot() {
  buildChrome();
  try {
    const res = await fetch(`/api/games/${gameId}/launch${params.get("core") ? `?core=${encodeURIComponent(params.get("core"))}` : ""}`, { headers: H });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "This game couldn't be started.");
    L = data;
  } catch (e) {
    return fail(e.message);
  }
  if (L.threads && !window.crossOriginIsolated) {
    return fail(`${L.system.short} games need a secure connection (https://, or http://localhost on the computer running Phosphor), because the ${L.system.short} emulator uses multiple threads. Every other console works over plain http.`);
  }
  document.title = `${L.game.title} · Phosphor`;
  document.documentElement.style.setProperty("--accent", L.system.color);
  paintLoader();

  const prefs = L.profile.settings || {};
  const filter = (prefs.filters || {})[L.system.id] || (HANDHELD.has(L.system.id) ? "sharp" : "sharp");
  applyLcd(filter);

  Object.assign(window, {
    EJS_player: "#game",
    EJS_core: L.core,
    EJS_gameUrl: L.gameUrl,
    EJS_gameName: `${L.game.id}-${L.game.title}`.replace(/[^\w\- ]+/g, "").slice(0, 60),
    EJS_gameID: L.game.id,
    EJS_pathtodata: L.emulatorPath,
    EJS_externalFiles: Object.keys(L.externalFiles).length ? L.externalFiles : undefined,
    EJS_gamePatchUrl: L.gamePatchUrl || undefined,
    EJS_threads: L.threads,
    EJS_startOnLoaded: true,
    EJS_color: L.system.color,
    EJS_backgroundColor: "#000000",
    EJS_volume: Number(localStorage.getItem("phosphor.volume") || 0.7),
    EJS_language: "en-US",
    EJS_noAutoFocus: false,
    EJS_defaultOptions: {
      rewindEnabled: REWIND_OK.has(L.system.id) ? "enabled" : "disabled",
      "rewind-granularity": "4",
      shader: FILTERS.find((f) => f.id === filter)?.shader || "disabled",
      "save-save-interval": "0",
    },
    EJS_Buttons: {
      playPause: false, restart: false, mute: false, settings: false, fullscreen: false, saveState: false, loadState: false,
      screenRecord: false, gamepad: false, cheat: false, volume: false, saveSavFiles: false, loadSavFiles: false,
      quickSave: false, quickLoad: false, screenshot: false, cacheManager: false, exitEmulation: false, netplay: false,
      diskButton: false, contextMenu: false,
    },
    EJS_onGameStart: onStart,
  });
  watchEmulatorText();
  const s = document.createElement("script");
  s.src = `${L.emulatorPath}loader.js`;
  s.onerror = () => fail("The emulator files are missing. Open Settings › Emulators and press Update.");
  document.body.append(s);
}

// ---------------- loading screen ----------------
let loader;
function buildChrome() {
  loader = el("div", { id: "loader" }, el("div", { class: "bg" }), el("div", { class: "inner" },
    el("div", { class: "box" }), el("h1", {}, "Loading…"), el("div", { class: "sys" }),
    el("div", { class: "progress" }, el("i")), el("div", { class: "status" }, "Warming up the emulator")),
  el("div", { class: "tip" }, isTouch ? "Tap the bar at the top for the menu" : "Press Esc, or Select + Start on a controller, for the menu"));
  document.body.append(loader, el("div", { id: "lcd" }), el("div", { id: "ptoasts" }));
}

function paintLoader() {
  const g = L.game;
  const art = g.box || g.snap || g.titleArt;
  if (art) $(".bg", loader).style.backgroundImage = `url("${art}")`;
  $(".box", loader).style.setProperty("--ar", L.system.box || 0.75);
  if (g.box) $(".box", loader).append(el("img", { src: g.box, alt: "" }));
  else if (L.system.photo) { $(".box", loader).classList.add("photo"); $(".box", loader).append(el("img", { src: L.system.photo, alt: "" })); }
  else $(".box", loader).style.display = "none";
  $("h1", loader).textContent = g.title;
  $(".sys", loader).textContent = L.system.name;
}

// Mirror EmulatorJS's own progress text into our loader (and catch its error messages).
function watchEmulatorText() {
  const obs = new MutationObserver(() => {
    const t = document.querySelector(".ejs_loading_text");
    if (!t) return;
    const text = t.innerText || "";
    const m = /(\d+)%/.exec(text);
    const bar = $(".progress", loader);
    if (m) { bar.classList.add("det"); bar.firstChild.style.width = `${m[1]}%`; }
    const friendly = text.replace("Download Game Core", "Loading the emulator").replace("Decompress Game Core", "Unpacking the emulator")
      .replace("Download Game Data", "Loading the game").replace("Decompress Game Data", "Unpacking the game")
      .replace("Download Game BIOS", "Loading BIOS").replace("Download Game State", "Loading your save");
    $(".status", loader).textContent = friendly;
    if (t.style.color === "red" || /error|failed|outdated/i.test(text)) {
      obs.disconnect();
      fail(/Outdated graphics/i.test(text) ? "This device's graphics are too old for this emulator. Try another browser or device." : `The emulator stopped: ${text.trim()}`);
    }
  });
  obs.observe(document.getElementById("game"), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style"] });
}

const CORE_NAMES = { mupen64plus_next: "Mupen64Plus", parallel_n64: "ParaLLEl N64", desmume2015: "DeSmuME", melonds: "melonDS", desmume: "DeSmuME (new)", pcsx_rearmed: "PCSX ReARMed", mednafen_psx_hw: "Beetle PSX", fceumm: "FCEUmm", nestopia: "Nestopia", genesis_plus_gx: "Genesis Plus GX", picodrive: "PicoDrive", smsplus: "SMS Plus", fbneo: "FinalBurn Neo", mame2003_plus: "MAME 2003-Plus", vice_x64sc: "VICE", vice_x128: "VICE", vice_xvic: "VICE", vice_xplus4: "VICE", vice_xpet: "VICE", "81": "EightyOne", prboom: "PrBoom" };
const coreName = (c) => CORE_NAMES[c] || c;

let failed = false;
function fail(message) {
  if (failed) return;
  failed = true;
  if (!loader) buildChrome();
  loader.classList.remove("done");
  $(".progress", loader)?.remove();
  $(".status", loader).textContent = "";
  // Offer the console's other emulator(s): some games only run on one of them.
  const others = (L?.cores || []).filter((c) => c !== L.core);
  $(".inner", loader).append(el("div", { class: "err" }, message),
    el("div", { class: "err-actions" },
      others.map((c) => el("button", { class: "hbtn", style: "width:auto;padding:0 18px;background:#fff;color:#000", onclick: () => location.replace(`/play/${gameId}?core=${c}`) }, `Try ${coreName(c)}`)),
      el("button", { class: "hbtn", style: "width:auto;padding:0 18px", onclick: () => location.reload() }, "Try again"),
      el("button", { class: "hbtn", style: "width:auto;padding:0 18px", onclick: () => exitTo() }, "Back")));
}

// A crashed emulator throws a WebAssembly trap; a hung one stops counting frames.
window.addEventListener("error", (e) => {
  if (/RuntimeError|out of bounds|unreachable|memory access|Aborted/i.test(e.message || "")) {
    fail(`The ${coreName(L?.core)} emulator crashed on this game.`);
  }
});
function watchForHang() {
  let last = -1, still = 0;
  setInterval(() => {
    if (failed || menuOpen || document.hidden || emu?.paused) { still = 0; return; }
    let f;
    try { f = emu.gameManager.getFrameNum(); } catch { return; }
    still = f === last ? still + 1 : 0;
    last = f;
    if (still >= 3) fail(`The ${coreName(L.core)} emulator stopped responding on this game.`);
  }, 2000);
}

// ---------------- after the game starts ----------------
async function onStart() {
  emu = window.EJS_emulator;
  started = true;
  // Cloud save first: if the server has a newer in-game save than this browser, load it and reboot.
  try {
    if (L.save) {
      const res = await fetch(`/api/games/${gameId}/save`, { headers: H });
      if (res.ok) {
        const remote = new Uint8Array(await res.arrayBuffer());
        const local = emu.gameManager.getSaveFile(false);
        if (!local || (await sha1(local)) !== (await sha1(remote))) {
          const p = emu.gameManager.getSaveFilePath();
          const dir = p.substring(0, p.lastIndexOf("/"));
          if (dir) mkdirp(dir);
          try { emu.gameManager.FS.unlink(p); } catch { /* none yet */ }
          emu.gameManager.FS.writeFile(p, remote);
          emu.gameManager.loadSaveFiles();
          emu.gameManager.restart();
        }
        lastSaveHash = await sha1(remote);
      }
    }
  } catch (e) { console.warn("save sync", e); }

  const slot = params.get("resume") ? 0 : params.get("state") ? Number(params.get("state")) : null;
  if (slot !== null) {
    await new Promise((r) => setTimeout(r, 250));
    const ok = await loadSlot(slot, { quiet: true });
    if (ok) ptoast("Picked up right where you left off", "resume");
  }

  if (cheatList().some((c) => c.on)) setTimeout(applyCheats, 500);
  watchForHang();
  // Picked a different emulator for this game and it started: remember it for next time.
  if (params.get("core")) {
    setTimeout(() => { if (!failed) fetch(`/api/games/${gameId}/core`, { method: "PUT", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ core: L.core }) }).catch(() => {}); }, 20000);
  }
  setTimeout(() => { if (!failed) loader.classList.add("done"); }, 150);
  buildHud();
  checkAudio();
  startSession();
  setInterval(syncSave, 15000);
  setInterval(autoResumeState, 4 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.hidden && !quitting) { syncSave(); autoResumeState(); } });
  window.addEventListener("pagehide", () => { if (!quitting) syncSave(true); });
  pollPads();
  if (params.get("pair")) openMenu("phone");
}

function mkdirp(dir) {
  let cur = "";
  for (const part of dir.split("/").filter(Boolean)) {
    cur += `/${part}`;
    try { emu.gameManager.FS.mkdir(cur); } catch { /* exists */ }
  }
}

// Content hash for change detection. crypto.subtle only exists on HTTPS, and Phosphor is usually
// opened over plain HTTP on the local network, so this is a small 53-bit hash (cyrb53) instead.
async function sha1(bytes) {
  let h1 = 0xdeadbeef ^ bytes.length, h2 = 0x41c6ce57 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${bytes.length}-${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

// Upload the in-game save whenever it changes.
async function syncSave(final = false) {
  if (!started) return;
  try {
    const data = emu.gameManager.getSaveFile(); // flushes the core's save RAM to disk first
    if (!data || !data.length) return;
    const hash = await sha1(data);
    if (hash === lastSaveHash) return;
    const ext = (emu.gameManager.getSaveFilePath().split(".").pop() || "srm").slice(0, 5);
    const res = await fetch(`/api/games/${gameId}/save?ext=${ext}`, { method: "PUT", headers: H, body: data, keepalive: final && data.length < 60000 });
    if (res.ok) lastSaveHash = hash;
  } catch (e) { console.warn("save upload", e); }
}

// ---------------- play time ----------------
async function startSession() {
  try {
    const r = await fetch(`/api/games/${gameId}/start`, { method: "POST", headers: H });
    sessionId = (await r.json()).session;
  } catch { /* offline: no stats */ }
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (!document.hidden && !menuOpen && !emu?.paused) playSeconds += Math.min(5, (now - lastTick) / 1000);
    lastTick = now;
  }, 1000);
  setInterval(pushSession, 20000);
}
function pushSession(final = false) {
  if (!sessionId) return;
  return fetch(`/api/sessions/${sessionId}`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ seconds: Math.round(playSeconds) }), keepalive: final }).catch(() => {});
}

// ---------------- save states ----------------
// The emulator only takes screenshots while running, so the menu grabs one before pausing.
let frozenShot = null;
async function screenshotBlob() {
  if (emu?.paused && frozenShot) return frozenShot;
  try {
    const png = await Promise.race([emu.gameManager.screenshot(), new Promise((r) => setTimeout(() => r(null), 1500))]);
    return png ? new Blob([png], { type: "image/png" }) : null;
  } catch { return null; }
}

async function saveSlot(slot, { quiet = false } = {}) {
  if (!emu?.gameManager?.supportsStates()) { if (!quiet) ptoast("This system can't make save states", "alert"); return false; }
  let state;
  try { state = emu.gameManager.getState(); } catch { if (!quiet) ptoast("Couldn't save a state right now", "alert"); return false; }
  const shot = await screenshotBlob();
  const r = await fetch(`/api/games/${gameId}/states/${slot}`, { method: "PUT", headers: { ...H, "x-core": L.core }, body: state.slice() });
  if (!r.ok) { if (!quiet) ptoast("Saving failed. Is the server reachable?", "alert"); return false; }
  if (shot) await fetch(`/api/games/${gameId}/states/${slot}/thumb`, { method: "PUT", headers: H, body: shot }).catch(() => {});
  if (!quiet) ptoast(slot === 0 ? "Saved your spot" : `Saved to slot ${slot}`, "save", shot ? URL.createObjectURL(shot) : null);
  return true;
}

async function loadSlot(slot, { quiet = false } = {}) {
  try {
    const r = await fetch(`/api/games/${gameId}/states/${slot}`, { headers: H });
    if (!r.ok) { if (!quiet) ptoast("That slot is empty", "alert"); return false; }
    emu.gameManager.loadState(new Uint8Array(await r.arrayBuffer()));
    if (!quiet) ptoast(slot === 0 ? "Back where you left off" : `Loaded slot ${slot}`, "load");
    return true;
  } catch (e) { if (!quiet) ptoast("Couldn't load that state", "alert"); return false; }
}

let lastAuto = 0;
async function autoResumeState() {
  if (!started || Date.now() - lastAuto < 30000) return;
  lastAuto = Date.now();
  try {
    const size = emu.gameManager.getState().length;
    if (size > 24 * 1024 * 1024) return; // huge states (PSP) only on quit
  } catch { return; }
  await saveSlot(0, { quiet: true });
}

// ---------------- leaving ----------------
async function quit() {
  if (quitting) return;
  quitting = true;
  ptoast("Saving your spot…", "save");
  try {
    if (menuOpen) { menuOpen = false; menu.classList.remove("open", "sub"); }
    await Promise.race([Promise.all([saveSlot(0, { quiet: true }), syncSave()]), new Promise((r) => setTimeout(r, 6000))]);
    emu?.pause?.();
    await pushSession(true);
  } catch { /* leave anyway */ }
  exitTo();
}

function exitTo() {
  padHost?.close();
  const ref = document.referrer && new URL(document.referrer).origin === location.origin ? new URL(document.referrer).pathname : null;
  if (ref && history.length > 1 && !ref.startsWith("/play/")) history.back();
  else location.replace(`/game/${gameId}`);
}

// ---------------- HUD ----------------
let hud, hideTimer;
function buildHud() {
  hud = el("div", { id: "hud" },
    el("button", { class: "hbtn", "aria-label": "Quit", onclick: quit }, ic("back")),
    el("div", { class: "title" }, L.game.title, el("small", {}, L.system.short)),
    el("button", { class: "hbtn", "aria-label": "Phone controller", onclick: () => openMenu("phone") }, ic("phone")),
    el("button", { class: "hbtn", "aria-label": "Save state", onclick: () => saveSlot(1) }, ic("save")),
    el("button", { class: "hbtn", "aria-label": "Load state", onclick: () => loadSlot(1) }, ic("load")),
    el("button", { class: "hbtn", id: "ffbtn", "aria-label": "Fast forward", onclick: () => setFastForward(!ff) }, ic("ff")),
    el("button", { class: "hbtn", "aria-label": "Full screen", onclick: toggleFullscreen }, ic("maximize")),
    el("button", { class: "hbtn", "aria-label": "Menu", onclick: () => openMenu() }, ic("menu")));
  document.body.append(hud,
    el("button", { id: "menu-fab", "aria-label": "Menu", onclick: () => openMenu() }, ic("menu")),
    el("div", { id: "ff-badge" }, ic("ff"), "Fast forward"),
    el("div", { id: "rec-badge" }, el("i"), "REC"),
    el("div", { id: "sound-pill" }, ic("volume"), isTouch ? "Tap for sound" : "Click or press a key for sound"));
  const show = () => {
    if (isTouch) return;
    hud.classList.add("show");
    document.body.style.cursor = "";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!hud.matches(":hover")) { hud.classList.remove("show"); document.body.style.cursor = "none"; } }, 2600);
  };
  window.addEventListener("mousemove", show, { passive: true });
  show();
  window.addEventListener("keydown", onKey, true);
}

function onKey(e) {
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); menuOpen ? closeMenu() : openMenu(); return; }
  if (menuOpen) return;
  if (e.key === "F2") { e.preventDefault(); saveSlot(1); }
  else if (e.key === "F4") { e.preventDefault(); loadSlot(1); }
  else if (e.key === "F11") { e.preventDefault(); toggleFullscreen(); }
  else if (e.key === "F8") { e.preventDefault(); takeScreenshot(); }
  else if (e.key === "F9") { e.preventDefault(); toggleRecording(); }
  else if (e.key === "Backspace" && !e.repeat && REWIND_OK.has(L.system.id)) { e.preventDefault(); e.stopPropagation(); emu.gameManager.simulateInput(0, 28, 1); }
}
window.addEventListener("keyup", (e) => {
  if (e.key === "Backspace" && started && REWIND_OK.has(L.system.id)) { e.stopPropagation(); emu.gameManager.simulateInput(0, 28, 0); }
}, true);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else {
    (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)?.call(document.documentElement);
    try { screen.orientation?.lock?.(L.system.id === "nds" ? "portrait" : "landscape").catch(() => {}); } catch { /* not supported */ }
  }
}

let slow = false;
function setSlowMotion(on) {
  slow = on;
  try { emu.menuOptionChanged("slowMotion", on ? "enabled" : "disabled"); } catch { emu.gameManager.toggleSlowMotion(on ? 1 : 0); }
  ptoast(on ? "Slow motion on" : "Slow motion off", "clock");
}

let ff = false;
function setFastForward(on) {
  ff = on;
  try { emu.menuOptionChanged("fastForward", on ? "enabled" : "disabled"); } catch { emu.gameManager.toggleFastForward(on ? 1 : 0); }
  document.body.classList.toggle("ff", on);
  $("#ffbtn")?.classList.toggle("on", on);
}

// Unmute after the first interaction if the browser blocked autoplay.
function checkAudio() {
  setTimeout(() => {
    const blocked = [...audioCtxs].some((c) => c.state === "suspended");
    if (!blocked) return;
    const pill = $("#sound-pill");
    pill.classList.add("on");
    const resume = () => {
      for (const c of audioCtxs) c.resume?.();
      pill.classList.remove("on");
      window.removeEventListener("pointerdown", resume, true);
      window.removeEventListener("keydown", resume, true);
    };
    window.addEventListener("pointerdown", resume, true);
    window.addEventListener("keydown", resume, true);
  }, 600);
}

function ptoast(text, iconName = "check", img = null) {
  const t = el("div", { class: "ptoast" }, img ? el("img", { src: img, alt: "" }) : ic(iconName), text);
  $("#ptoasts").append(t);
  setTimeout(() => { t.style.transition = "opacity .3s"; t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 2400);
}

// ---------------- pause menu ----------------
let menu, panel;
function openMenu(section = null) {
  if (!started) return;
  if (!menuOpen) { menu?.remove(); buildMenu(); } // rebuilt each time so values (fast forward, filter) are current
  if (!menuOpen) {
    menuOpen = true;
    menu.classList.add("open");
    // Grab the current frame for save-state thumbnails, then pause.
    frozenShot = null;
    screenshotBlob().then((b) => { frozenShot = b; }).finally(() => { if (menuOpen) { try { emu.pause(); } catch { /* not ready */ } } });
    syncSave();
  }
  showPanel(section || "home");
  setTimeout(() => (section ? panel.querySelector("button") : menu.querySelector(".mi"))?.focus(), 30);
}
function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  menu.classList.remove("open", "sub");
  try { emu.play(); } catch { /* ignore */ }
  document.querySelector("#game")?.focus?.();
  try { emu.elements.parent.focus(); } catch { /* ignore */ }
}

function buildMenu() {
  const g = L.game;
  const mi = (iconName, label, onclick, opts = {}) => el("button", { class: `mi ${opts.cls || ""}`, onclick }, ic(iconName), label, opts.val ? el("span", { class: "val" }, opts.val) : null);
  panel = el("div", { class: "panel" });
  const side = el("div", { class: "side" },
    el("div", { class: "gtitle" }, g.box ? el("img", { src: g.box, alt: "" }) : null, el("div", {}, el("b", {}, g.title), el("span", {}, L.system.name))),
    mi("play", "Resume", closeMenu, { cls: "primary" }),
    mi("save", "Save state", () => showPanel("save", true)),
    mi("load", "Load state", () => showPanel("load", true)),
    mi("monitor", "Display", () => showPanel("display", true), { val: currentFilter().name }),
    mi("phone", "Phone as controller", () => showPanel("phone", true)),
    mi("gamepad", "Controls", () => showPanel("controls", true)),
    diskCount() > 1 ? mi("disc", "Swap disc", () => showPanel("disc", true), { val: `Disc ${currentDisk() + 1} of ${diskCount()}` }) : null,
    (L.cores || []).length > 1 ? mi("cpu", "Emulator", () => showPanel("emulator", true), { val: coreName(L.core) }) : null,
    mi("zap", "Cheats", () => showPanel("cheats", true), { val: cheatList().filter((c) => c.on).length ? `${cheatList().filter((c) => c.on).length} on` : "" }),
    el("div", { class: "sep" }),
    mi("camera", "Screenshot", () => takeScreenshot()),
    mi("video", recorder ? "Stop recording" : "Record a clip", () => { toggleRecording(); closeMenu(); }, { val: recorder ? "REC" : "" }),
    mi(volume() ? "volume" : "mute", "Volume", () => { cycleVolume(); showPanel("home"); const v = menu.querySelector(".mi.vol .val"); if (v) v.textContent = `${Math.round(volume() * 100)}%`; }, { val: `${Math.round(volume() * 100)}%`, cls: "vol" }),
    mi("ff", "Fast forward", () => { setFastForward(!ff); closeMenu(); }, { val: ff ? "On" : "Off" }),
    mi("clock", "Slow motion", () => { setSlowMotion(!slow); closeMenu(); }, { val: slow ? "On" : "Off" }),
    mi("restart", "Restart game", () => { emu.gameManager.restart(); closeMenu(); ptoast("Restarted", "restart"); }),
    mi("maximize", "Full screen", () => { toggleFullscreen(); }),
    el("div", { class: "sep" }),
    mi("power", "Save & quit", quit, { cls: "danger" }));
  menu = el("div", { id: "menu" }, side, panel);
  menu.addEventListener("click", (e) => { if (e.target === menu) closeMenu(); });
  document.body.append(menu);
}

// ---------------- discs, cheats, screenshots, volume ----------------
function diskCount() { try { return emu.gameManager.getDiskCount() || 0; } catch { return 0; } }
function currentDisk() { try { return emu.gameManager.getCurrentDisk() || 0; } catch { return 0; } }

function cheatList() { return ((L.profile.settings || {}).cheats || {})[L.game.id] || []; }
function saveCheats(list) {
  const prefs = L.profile.settings || (L.profile.settings = {});
  prefs.cheats = { ...(prefs.cheats || {}), [L.game.id]: list };
  fetch(`/api/profiles/${L.profile.id}`, { method: "PATCH", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ settings: { cheats: prefs.cheats } }) }).catch(() => {});
}
function applyCheats() {
  try {
    emu.gameManager.resetCheat();
    cheatList().forEach((c, i) => { if (c.on) emu.gameManager.setCheat(i, 1, c.code); });
  } catch (e) { console.warn("cheats", e); }
}

async function takeScreenshot() {
  const shot = await screenshotBlob();
  if (!shot) return ptoast("Couldn't take a screenshot", "alert");
  const r = await fetch(`/api/games/${gameId}/screenshots`, { method: "PUT", headers: H, body: shot }).catch(() => null);
  ptoast(r?.ok ? "Screenshot saved" : "Screenshot failed", "camera", URL.createObjectURL(shot));
}

// Clip recording: the game picture plus its sound, saved to Screenshots/ on the server.
let recorder = null;
function toggleRecording() {
  if (recorder) { recorder.stop(); return; }
  try {
    // Copy frames into a 2D canvas and record that (works everywhere, including software GL).
    const src = emu.canvas;
    const cap = document.createElement("canvas");
    cap.width = src.width; cap.height = src.height;
    const ctx = cap.getContext("2d");
    let drawing = true;
    const draw = () => {
      if (!drawing) return;
      if (cap.width !== src.width || cap.height !== src.height) { cap.width = src.width; cap.height = src.height; }
      ctx.drawImage(src, 0, 0);
      requestAnimationFrame(draw);
    };
    draw();
    const stream = emu.collectScreenRecordingMediaTracks(cap, 30);
    const type = ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"].find((t) => window.MediaRecorder?.isTypeSupported(t));
    if (!stream || !type) throw new Error("not supported");
    const chunks = [];
    const mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5e6 });
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const cap5 = setTimeout(() => mr.state === "recording" && mr.stop(), 5 * 60 * 1000);
    mr.onstop = async () => {
      drawing = false;
      clearTimeout(cap5);
      recorder = null;
      document.body.classList.remove("rec");
      const blob = new Blob(chunks, { type: type.split(";")[0] });
      ptoast("Saving clip…", "video");
      const r = await fetch(`/api/games/${gameId}/clips`, { method: "PUT", headers: { ...H, "content-type": blob.type }, body: blob }).catch(() => null);
      ptoast(r?.ok ? "Clip saved to Screenshots" : "Couldn't save the clip", r?.ok ? "check" : "alert");
    };
    mr.start(1000);
    recorder = mr;
    document.body.classList.add("rec");
    ptoast("Recording. Press F9 or use the menu to stop", "video");
  } catch (e) {
    ptoast("This browser can't record clips", "alert");
  }
}

function volume() { return Number(localStorage.getItem("phosphor.volume") ?? 0.7); }
function cycleVolume() {
  const steps = [0, 0.25, 0.5, 0.75, 1];
  const next = steps[(steps.findIndex((v) => v >= volume() - 0.01) + 1) % steps.length];
  localStorage.setItem("phosphor.volume", String(next));
  try { emu.setVolume(next); } catch { /* not ready */ }
}

function currentFilter() {
  const f = ((L.profile.settings || {}).filters || {})[L.system.id] || "sharp";
  return FILTERS.find((x) => x.id === f) || FILTERS[0];
}

async function showPanel(name, focus = false) {
  menu.classList.toggle("sub", name !== "home");
  const back = el("button", { class: "mi", style: "width:auto;margin-bottom:12px", onclick: () => { menu.classList.remove("sub"); showPanel("home"); menu.querySelector(".mi")?.focus(); } }, ic("back"), "Back");
  if (name === "home") {
    panel.replaceChildren(el("h2", {}, "Paused"), el("p", { class: "sub" }, `Your in-game progress syncs automatically. "Save & quit" also saves this exact moment so you can resume on any device.`), helpGrid());
  } else if (name === "save" || name === "load") {
    const states = await fetch(`/api/games/${gameId}/states`, { headers: H }).then((r) => r.json()).catch(() => []);
    const bySlot = new Map(states.map((s) => [s.slot, s]));
    const slots = name === "save" ? [1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((n) => bySlot.has(n));
    panel.replaceChildren(back, el("h2", {}, name === "save" ? "Save state" : "Load state"),
      el("p", { class: "sub" }, name === "save" ? "Freeze this exact moment in a slot. It's stored on the server, so it's there on every device." : "Jump back to a moment you saved."),
      slots.length ? el("div", { class: "slots" }, slots.map((n) => {
        const s = bySlot.get(n);
        const shot = el("div", { class: "shot" });
        if (s) shot.style.backgroundImage = `url("${s.thumb}")`; else shot.append(ic("plus"));
        return el("button", { class: `slot ${n === 0 ? "auto" : ""}`, onclick: async () => {
          if (name === "save") { await saveSlot(n); closeMenu(); } else { closeMenu(); await loadSlot(n); }
        } }, shot, el("div", { class: "cap" }, el("b", {}, n === 0 ? "Auto (last quit)" : `Slot ${n}`), el("span", {}, s ? ago(s.createdAt) : "Empty")));
      })) : el("p", {}, "No save states yet. Use Save state to make one."));
  } else if (name === "display") {
    const cur = currentFilter().id;
    panel.replaceChildren(back, el("h2", {}, "Display"), el("p", { class: "sub" }, `How ${L.system.short} games look. Remembered for every ${L.system.short} game.`),
      el("div", { class: "choices" }, FILTERS.map((f) => el("button", { class: `choice ${f.id === cur ? "on" : ""}`, onclick: () => { setFilter(f); showPanel("display"); } }, el("b", {}, f.name), el("span", {}, f.desc)))));
  } else if (name === "phone") {
    panel.replaceChildren(back, el("h2", {}, "Use your phone as a controller"), el("p", { class: "sub" }, "Scan with your phone's camera. Up to four phones can join, each one becomes the next player."), await pairPanel());
  } else if (name === "emulator") {
    panel.replaceChildren(back, el("h2", {}, "Emulator"), el("p", { class: "sub" }, `${L.system.short} has more than one emulator built in. If a game glitches or won't start, try another one. Phosphor remembers your pick for this game.`),
      el("div", { class: "choices" }, L.cores.map((c, i) => el("button", { class: `choice ${c === L.core ? "on" : ""}`, onclick: async () => {
        if (c === L.core) return closeMenu();
        await Promise.race([syncSave(), new Promise((r) => setTimeout(r, 2000))]);
        location.replace(`/play/${gameId}?core=${c}`);
      } }, el("b", {}, coreName(c)), el("span", {}, i === 0 ? "Default" : "Alternative")))));
  } else if (name === "disc") {
    const n = diskCount(), cur = currentDisk();
    panel.replaceChildren(back, el("h2", {}, "Swap disc"), el("p", { class: "sub" }, "When the game asks for the next disc, pick it here."),
      el("div", { class: "choices" }, Array.from({ length: n }, (_, i) => el("button", { class: `choice ${i === cur ? "on" : ""}`, onclick: () => {
        try { emu.gameManager.setCurrentDisk(i); ptoast(`Disc ${i + 1} inserted`, "disc"); } catch { ptoast("Couldn't swap discs", "alert"); }
        closeMenu();
      } }, el("b", {}, `Disc ${i + 1}`), el("span", {}, i === cur ? "In the drive now" : "Insert this disc")))));
  } else if (name === "cheats") {
    const list = cheatList();
    const desc = el("input", { class: "cheat-in", placeholder: "Name (e.g. Infinite lives)", maxlength: 60 });
    const code = el("input", { class: "cheat-in", placeholder: "Code (Game Genie, Action Replay, GameShark…)", maxlength: 200 });
    panel.replaceChildren(back, el("h2", {}, "Cheats"), el("p", { class: "sub" }, `Codes are saved for this game. Type them exactly as written, e.g. Game Genie codes for ${L.system.short}.`),
      el("div", { class: "choices" }, list.map((c, i) => el("button", { class: `choice ${c.on ? "on" : ""}`, onclick: () => { c.on = !c.on; saveCheats(list); applyCheats(); showPanel("cheats", true); } },
        el("b", {}, c.desc || `Cheat ${i + 1}`), el("span", {}, `${c.on ? "On" : "Off"} · ${c.code}`)))),
      el("div", { class: "cheat-form" }, desc, code,
        el("button", { class: "mi", style: "width:auto", onclick: () => {
          if (!code.value.trim()) return;
          list.push({ desc: desc.value.trim(), code: code.value.trim(), on: true });
          saveCheats(list); applyCheats(); showPanel("cheats", true); ptoast("Cheat added and turned on", "zap");
        } }, ic("plus"), "Add cheat"),
        list.length ? el("button", { class: "mi danger", style: "width:auto", onclick: () => { saveCheats([]); applyCheats(); showPanel("cheats", true); } }, ic("trash"), "Remove all") : null));
  } else if (name === "controls") {
    panel.replaceChildren(back, el("h2", {}, "Controls"),
      el("p", { class: "sub" }, "Controllers work as soon as you plug them in. You can remap any button here."),
      el("button", { class: "mi", style: "width:auto", onclick: () => { closeMenu(); setTimeout(() => { try { emu.controlMenu.style.display = ""; } catch { /* ignore */ } }, 50); } }, ic("sliders"), "Remap buttons"),
      el("div", { style: "height:18px" }), helpGrid());
  }
  if (focus) setTimeout(() => (panel.querySelector("button:not(.mi)") || panel.querySelector("button"))?.focus(), 30);
}

function helpGrid() {
  const rows = isTouch
    ? [["Menu", "Tap the bar at the top"], ["Save state", "Menu › Save state"], ["Phone controller", "Menu › Phone as controller"]]
    : [["Menu", "Esc · Select + Start"], ["Quick save", "F2 · Select + R"], ["Quick load", "F4 · Select + L"], ["Fast forward", "Select + R2 (hold)"], ["Rewind", "Backspace · Select + L2 (hold)"], ["Screenshot", "F8"], ["Record a clip", "F9"], ["Full screen", "F11"], ["Keyboard A / B", "X / Z"], ["Keyboard Start / Select", "Enter / V"]];
  return el("div", { class: "help" }, rows.map(([a, b]) => el("div", {}, el("span", {}, a), el("kbd", {}, b))));
}

function setFilter(f) {
  const prefs = L.profile.settings || {};
  prefs.filters = { ...(prefs.filters || {}), [L.system.id]: f.id };
  L.profile.settings = prefs;
  try { emu.menuOptionChanged("shader", f.shader); } catch { /* shader failed: keep going */ }
  applyLcd(f.id);
  fetch(`/api/profiles/${L.profile.id}`, { method: "PATCH", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ settings: { filters: prefs.filters } }) }).catch(() => {});
  const val = menu.querySelector(".mi .val");
  if (val) val.textContent = f.name;
}
function applyLcd(id) { document.body.classList.toggle("lcd", FILTERS.find((x) => x.id === id)?.lcd === true); }

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

// ---------------- phone controllers ----------------
const padSlots = new Map();
let roomCode = null;
function ensurePadHost() {
  if (padHost && padHost.readyState <= 1) return Promise.resolve();
  return new Promise((resolve) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    padHost = new WebSocket(`${proto}://${location.host}/ws/pad?role=host&pad=${encodeURIComponent(L.system.pad)}&title=${encodeURIComponent(L.game.title)}`);
    padHost.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "room") { roomCode = m.code; resolve(); }
      else if (m.type === "i") {
        const list = Array.isArray(m.d[0]) ? m.d : [m.d];
        for (const [i, v] of list) emu?.gameManager?.simulateInput(m.p, i, v);
      } else if (m.type === "pad-joined") {
        padSlots.set(m.player, m.name);
        ptoast(`${m.name} joined as player ${m.player + 1}`, "phone");
        refreshPadSlots();
        if (menuOpen && padSlots.size === 1) closeMenu();
      } else if (m.type === "pad-left") {
        padSlots.delete(m.player);
        ptoast(`Player ${m.player + 1}'s phone disconnected`, "phone");
        refreshPadSlots();
      } else if (m.type === "menu") {
        menuOpen ? closeMenu() : openMenu();
      }
    };
    padHost.onclose = () => { roomCode = null; padHost = null; resolve(); };
  });
}

async function pairPanel() {
  await ensurePadHost();
  if (!roomCode) return el("p", {}, "Couldn't start pairing. Check the connection to the server.");
  const origin = (L.publicUrl || location.origin).replace(/\/$/, "");
  const url = `${origin}/pad?room=${roomCode}`;
  const local = !L.publicUrl && /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  setTimeout(refreshPadSlots, 0);
  return el("div", { class: "pair" },
    el("div", { class: "qr" }, el("img", { src: qr.createDataURL(8, 0), alt: "QR code" })),
    el("div", {},
      el("div", { style: "color:rgba(255,255,255,.6);font-weight:600" }, "Or open this on your phone"),
      el("div", { style: "font-weight:700;font-size:18px;margin-top:4px;word-break:break-all" }, `${origin.replace(/^https?:\/\//, "")}/pad`),
      local ? el("div", { style: "color:#fbbf24;font-size:13px;margin-top:6px;max-width:340px" }, "This screen opened Phosphor as localhost, which your phone can't reach. Open Phosphor here using the computer's network address instead.") : null,
      el("div", { style: "color:rgba(255,255,255,.6);font-weight:600;margin-top:14px" }, "and enter the code"),
      el("div", { class: "code" }, roomCode),
      el("div", { class: "pads", id: "padslots" })));
}
function refreshPadSlots() {
  const host = document.getElementById("padslots");
  if (!host) return;
  host.replaceChildren(...[0, 1, 2, 3].map((p) => el("div", { class: `padslot ${padSlots.has(p) ? "on" : ""}` }, el("i"), padSlots.has(p) ? `P${p + 1} · ${padSlots.get(p)}` : `Player ${p + 1}`)));
}

// ---------------- controller hotkeys + menu navigation ----------------
function pollPads() {
  const prev = new Map();
  let rewinding = false;
  const loop = () => {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    for (const p of pads) {
      const b = (i) => !!p.buttons[i]?.pressed;
      const was = prev.get(p.index) || [];
      const down = (i) => b(i) && !was[i];
      const sel = b(8);
      if ((sel && down(9)) || (b(9) && down(8)) || down(16)) { menuOpen ? closeMenu() : openMenu(); }
      else if (menuOpen) {
        if (down(12) || (p.axes[1] < -0.6 && !(was.axUp))) moveFocus(-1);
        if (down(13) || (p.axes[1] > 0.6 && !(was.axDown))) moveFocus(1);
        if (down(14)) moveFocus(-1, true);
        if (down(15)) moveFocus(1, true);
        if (down(0)) document.activeElement?.click();
        if (down(1)) { const back = panel.querySelector(".mi"); if (menu.classList.contains("sub") && back) back.click(); else closeMenu(); }
      } else if (sel) {
        if (down(5)) saveSlot(1);
        if (down(4)) loadSlot(1);
        if (down(7)) setFastForward(true);
        if (b(6) && !rewinding && REWIND_OK.has(L.system.id)) { rewinding = true; emu.gameManager.simulateInput(0, 28, 1); }
      }
      if (ff && was[7] && !b(7) && was[8]) setFastForward(false);
      if (rewinding && !b(6)) { rewinding = false; emu.gameManager.simulateInput(0, 28, 0); }
      const st = p.buttons.map((x) => x.pressed);
      st.axUp = p.axes[1] < -0.6; st.axDown = p.axes[1] > 0.6;
      prev.set(p.index, st);
    }
  };
  // A steady timer rather than animation frames: frames stop while the game is paused in the menu.
  setInterval(loop, 16);
}

function moveFocus(dir, horizontal = false) {
  const items = [...menu.querySelectorAll(menu.classList.contains("sub") && !matchMedia("(max-width: 760px)").matches ? ".side .mi, .panel button" : ".open button")].filter((b) => b.offsetParent);
  const scope = items.filter((b) => (panel.contains(document.activeElement) ? panel.contains(b) : !panel.contains(b)));
  const list = horizontal ? items : scope.length ? scope : items;
  const i = list.indexOf(document.activeElement);
  if (horizontal) {
    // Left/right jumps between the side list and the panel.
    const target = dir > 0 ? panel.querySelector("button:not(.mi)") || panel.querySelector("button") : menu.querySelector(".side .mi");
    target?.focus();
    return;
  }
  const next = list[(i + dir + list.length) % list.length] || list[0];
  next?.focus();
  next?.scrollIntoView({ block: "nearest" });
}

boot();
