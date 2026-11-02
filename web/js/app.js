// App shell: router, navigation rail, live server events, drag-and-drop uploads, player picker.
import { api, setProfile, getProfile } from "./api.js";
import { store, refreshState } from "./store.js";
import { h, $, $$, ic, svg, toast, toastError, sheet, closeTopSheet, sheetOpen, plural, setAmbient, setAccent, fmtBytes, promptBox, imageColor } from "./ui.js";
import { LOGO } from "./icons.js";
import { initNav, setNavHandlers, focusables, focusEl, onActivity } from "./nav.js";
import { sound } from "./sound.js";
import { freeGamesSheet } from "./freegames.js";
import { initUpdates } from "./update.js";

const ROUTES = [
  { re: /^\/$/, view: () => import("./views/home.js"), nav: "home" },
  { re: /^\/library\/?$/, view: () => import("./views/library.js"), nav: "library" },
  { re: /^\/system\/([\w-]+)\/?$/, view: () => import("./views/system.js"), nav: "library", keys: ["id"] },
  { re: /^\/game\/(\d+)\/?$/, view: () => import("./views/game.js"), nav: "library", keys: ["id"] },
  { re: /^\/search\/?$/, view: () => import("./views/search.js"), nav: "search" },
  { re: /^\/collections\/?$/, view: () => import("./views/collections.js"), nav: "collections" },
  { re: /^\/collection\/(\d+)\/?$/, view: () => import("./views/collections.js"), nav: "collections", keys: ["id"] },
  { re: /^\/stats\/?$/, view: () => import("./views/stats.js"), nav: "stats" },
  { re: /^\/settings(?:\/([\w-]+))?\/?$/, view: () => import("./views/settings.js"), nav: "settings", keys: ["section"] },
];
const NAV = [
  { id: "home", label: "Home", icon: "home", href: "/" },
  { id: "library", label: "Library", icon: "library", href: "/library" },
  { id: "search", label: "Search", icon: "search", href: "/search" },
  { id: "collections", label: "Shelves", icon: "layers", href: "/collections", cls: "hide-m" },
  { id: "stats", label: "Stats", icon: "chart", href: "/stats", cls: "hide-m" },
  { id: "settings", label: "Settings", icon: "settings", href: "/settings" },
];

let current = null; // { el, destroy, path }
let navToken = 0;

// ---------- router ----------
function match(pathname) {
  for (const r of ROUTES) {
    const m = r.re.exec(pathname);
    if (m) return { route: r, params: Object.fromEntries((r.keys || []).map((k, i) => [k, m[i + 1]])) };
  }
  return null;
}

export async function navigate(path, { replace = false, restoreScroll = null } = {}) {
  const url = new URL(path, location.origin);
  if (url.pathname.startsWith("/play/")) { leaveTo(url.pathname + url.search); return; }
  if (!replace && url.pathname + url.search === location.pathname + location.search && current) return;
  if (current) history.replaceState({ ...(history.state || {}), scroll: scrollY }, "");
  if (replace) history.replaceState({}, "", url.pathname + url.search);
  else history.pushState({}, "", url.pathname + url.search);
  await render(restoreScroll);
}

// Starting a game is a full page load (clean emulator memory each time), with a fade out.
export function leaveTo(path) {
  document.body.style.transition = "opacity .25s";
  document.body.style.opacity = "0";
  setTimeout(() => location.assign(path), 180);
}
store.go = (p) => navigate(p);

async function render(restoreScroll = null) {
  const token = ++navToken;
  if (store.profile?.settings?.kid && /^\/(settings|stats)/.test(location.pathname)) history.replaceState({}, "", "/");
  const m = match(location.pathname) || { route: ROUTES[0], params: {} };
  const view = $("#view");
  const query = Object.fromEntries(new URLSearchParams(location.search));
  setActiveNav(m.route.nav);
  let mod;
  try { mod = await m.route.view(); } catch (e) { toastError(e, "Couldn't load that page"); return; }
  if (token !== navToken) return;
  const old = current;
  if (old?.el) old.el.classList.add("leaving");
  let result;
  try {
    result = await mod.default({ params: m.params, query, path: location.pathname });
  } catch (e) {
    if (token !== navToken) return;
    result = { el: h("div.page", h("div.empty-state", h("h2", "That didn't load"), h("p", e.message), h("button.btn", { onclick: () => render() }, "Try again"))) };
  }
  if (token !== navToken) { result?.destroy?.(); return; }
  old?.destroy?.();
  const el = result.el;
  el.classList.add("view");
  view.replaceChildren(el);
  current = { ...result, path: location.pathname };
  document.title = result.title ? `${result.title} · Phosphor` : "Phosphor";
  setAccent(result.accent || "#7c5cff");
  if (result.ambient) setAmbient(result.ambient);
  else setAmbient(["#4b2fd6", "#0e7d74", "#2b1b5e"]);
  window.scrollTo(0, restoreScroll ?? history.state?.scroll ?? 0);
  if (document.body.classList.contains("pad") || (result.autofocus && usedKeyboard)) {
    const first = () => { const all = focusables().filter((x) => x.closest("main")); return all.find((x) => x.classList.contains("gcard")) || all.find((x) => !["INPUT", "SELECT"].includes(x.tagName)) || all[0]; };
    requestAnimationFrame(() => focusEl((result.autofocus && $(result.autofocus, el)) || first()));
  }
}

// Only move focus for people navigating by keyboard or controller (no focus rings for mouse/touch).
let usedKeyboard = false;
window.addEventListener("keydown", (e) => { if (e.key.startsWith("Arrow") || e.key === "Tab") usedKeyboard = true; }, true);
window.addEventListener("pointerdown", () => { usedKeyboard = false; }, true);

window.addEventListener("popstate", () => render(history.state?.scroll ?? 0));
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a || a.target || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/") || a.hasAttribute("download")) return;
  e.preventDefault();
  sound.play("select");
  navigate(url.pathname + url.search);
});

// ---------- shell ----------
function setActiveNav(id) {
  $$(".rail-btn[data-id]").forEach((b) => b.classList.toggle("active", b.dataset.id === id));
}

function buildShell() {
  const rail = h("nav.rail", { "aria-label": "Main" },
    h("a.logo", { href: "/", "aria-label": "Phosphor home", html: LOGO }),
    NAV.map((n) => h("a.rail-btn", { href: n.href, "data-id": n.id, class: n.cls || "", "data-nav": "" }, ic(n.icon), h("span", n.label))),
    h("button.rail-btn.add-btn", { "data-nav": "", "aria-label": "Add games", onclick: () => addGamesSheet() }, ic("plus"), h("span", "Add games")),
    h("div.spacer"),
    h("div.scan-pill#scanpill", h("i"), h("span", "Scanning")),
    h("button.rail-btn#who-btn", { "data-nav": "", "aria-label": "Switch player", onclick: () => profileSheet() }, h("span.avatar#rail-avatar")));
  const shell = h("div.shell", rail, h("main#view"));
  document.body.prepend(h("div#ambient", h("div.blob.b1"), h("div.blob.b2"), h("div.blob.b3")), shell,
    h("div#dropzone", h("div.ring", h("div", ic("upload"), h("h2", "Drop to add games"), h("p", "Any console, zipped or not. Phosphor sorts them for you.")))),
    h("div#hints", h("span", h("kbd.a", "A"), "Select"), h("span", h("kbd.b", "B"), "Back"), h("span", h("kbd.x", "X"), "Favorite"), h("span", h("kbd.y", "Y"), "Search"), h("span", h("kbd", "LB/RB"), "Sections")),
    h("input#file-input", { type: "file", multiple: true, hidden: true, onchange: (e) => { uploadFiles([...e.target.files].map((f) => ({ file: f, path: f.name }))); e.target.value = ""; } }),
    // Whole folders keep their layout (multi-file and folder games stay together).
    h("input#folder-input", { type: "file", multiple: true, hidden: true, webkitdirectory: true, onchange: (e) => { uploadFiles([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))); e.target.value = ""; } }));
  updateRail();
}

function updateRail() {
  const p = store.profile;
  const kid = !!p?.settings?.kid;
  document.body.classList.toggle("kid", kid);
  for (const id of ["settings", "stats"]) { const b = $(`.rail-btn[data-id="${id}"]`); if (b) b.hidden = kid; }
  const av = $("#rail-avatar");
  if (av && p) { av.textContent = p.avatar; av.style.setProperty("--c", p.color); }
  const set = $('.rail-btn[data-id="settings"]');
  const needs = store.state?.emulators?.state?.check && !store.state.emulators.state.check.upToDate;
  if (set) { set.querySelector(".dot")?.remove(); if (needs || !store.state?.emulators?.active) set.append(h("i.dot")); }
}

// ---------- players ----------
export function profileSheet() {
  const body = h("div.list",
    store.profiles.map((p) => h("button.list-item", { "data-nav": "", onclick: () => { s.close(); switchProfile(p.id); } },
      h("span.avatar", { "--c": p.color, style: { width: "44px", height: "44px", fontSize: "22px" } }, p.avatar),
      h("div.grow", h("div.t", p.name), h("div.d", p.id === store.profile.id ? "Playing now" : "Switch to this player")),
      p.id === store.profile.id ? ic("check") : null)),
    h("button.list-item", { "data-nav": "", onclick: () => { s.close(); navigate("/settings/players"); } }, ic("users"), h("div.grow", h("div.t", "Manage players"), h("div.d", "Add family and friends, each with their own saves"))));
  const s = sheet({ title: "Who's playing?", body });
}

// Leaving a kid profile for a grown-up one needs the parent PIN (when one is set).
async function pinAllows(targetId) {
  const target = store.profiles.find((p) => p.id === targetId);
  if (!store.profile?.settings?.kid || target?.settings?.kid || !store.settings.hasPin) return true;
  const pin = await promptBox("Parent PIN", { placeholder: "4 digits", ok: "Unlock" });
  if (pin === null) return false;
  const r = await api.post("/api/parent/check", { pin }).catch(() => ({ ok: false }));
  if (!r.ok) { toast({ title: "That PIN isn't right", icon: "lock", kind: "bad" }); sound.play("error"); }
  return r.ok;
}

async function switchProfile(id) {
  if (!(await pinAllows(id))) return;
  setProfile(id);
  sessionStorage.setItem("phosphor.picked", "1");
  await refreshState();
  updateRail();
  const p = store.profile;
  toast({ title: `Hi, ${p.name}`, text: "Your saves and favorites are loaded.", icon: "users" });
  render();
}

function whoIsPlaying() {
  if (store.profiles.length < 2 || sessionStorage.getItem("phosphor.picked")) return;
  const el = h("div.who", h("div",
    h("h1", "Who's playing?"),
    h("div.people", store.profiles.map((p) => h("button.person", {
      "data-nav": "", onclick: async () => { if (!(await pinAllows(p.id))) return; el.remove(); switchProfile(p.id); },
    }, h("span.avatar", { "--c": p.color }, p.avatar), h("b", p.name))))));
  document.body.append(el);
  setTimeout(() => el.querySelector(".person")?.focus(), 50);
}

// ---------- live events ----------
let addedBatch = [];
let addedTimer = null;
const artIds = new Set();
let artTimer = null;

function connectEvents() {
  const es = new EventSource("/api/events");
  es.addEventListener("library", (e) => {
    const s = JSON.parse(e.data);
    const pill = $("#scanpill");
    const busy = s.phase !== "idle";
    pill?.classList.toggle("on", busy);
    if (pill && busy) pill.querySelector("span").textContent = s.phase === "sorting" ? "Sorting drops" : s.total ? `Scanning ${s.done}/${s.total}` : "Scanning";
    if (!busy && s.lastScan) {
      if (s.unknown?.length && s.lastScan.reason !== "periodic") toast({ title: `${plural(s.unknown.length, "file")} not recognised`, text: "They're still in the drop folder. See Settings › Library.", icon: "alert", timeout: 7000 });
      refreshState().then(() => { updateRail(); window.dispatchEvent(new CustomEvent("phosphor:library")); });
    }
  });
  es.addEventListener("game", (e) => {
    const g = JSON.parse(e.data);
    if (!g.isNew) return;
    addedBatch.push(g.id);
    clearTimeout(addedTimer);
    addedTimer = setTimeout(announceAdded, 1200);
  });
  es.addEventListener("art", (e) => {
    artIds.add(JSON.parse(e.data).id);
    clearTimeout(artTimer);
    artTimer = setTimeout(applyArt, 900);
  });
  es.addEventListener("info", (e) => {
    const { id } = JSON.parse(e.data);
    if (location.pathname === `/game/${id}` && !sheetOpen()) render(scrollY);
  });
  es.addEventListener("emulators", (e) => {
    const s = JSON.parse(e.data);
    window.dispatchEvent(new CustomEvent("phosphor:emulators", { detail: s }));
    if (s.phase === "done" || s.phase === "failed") refreshState().then(updateRail);
  });
}

async function announceAdded() {
  const ids = addedBatch.splice(0);
  if (!ids.length) return;
  if (ids.length === 1) {
    try {
      const g = await api.get(`/api/games/${ids[0]}`);
      toast({ title: `Added ${g.title}`, text: g.systemInfo.name, icon: "sparkles", kind: "good" });
    } catch { /* gone already */ }
  } else {
    toast({ title: `Added ${plural(ids.length, "game")}`, text: "Box art is on its way.", icon: "sparkles", kind: "good" });
  }
  sound.play("success");
}

// New box art arrived: swap it into any card showing that game, without re-rendering the page.
async function applyArt() {
  const ids = [...artIds];
  artIds.clear();
  const visibleIds = ids.filter((id) => document.querySelector(`[data-game-id="${id}"]`));
  if (!visibleIds.length) return;
  const games = await api.get(`/api/games?ids=${visibleIds.join(",")}`).catch(() => []);
  const { gameCard } = await import("./ui.js");
  for (const g of games) {
    for (const old of $$(`.gcard[data-game-id="${g.id}"]`)) {
      if (!g.box || old.querySelector("img.art")) continue;
      const fresh = gameCard(g, { systems: store.systems, ratio: old.style.getPropertyValue("--ar") || 0.75, onOpen: (x) => navigate(`/game/${x.id}`), resumable: !!old.querySelector(".resume"), showSystem: !!old.querySelector(".gcard-sub")?.textContent.includes(store.systems[g.system]?.short) });
      old.replaceWith(fresh);
    }
  }
}

// ---------- uploads (drag and drop anywhere, or the Add games button) ----------
let dragDepth = 0;
function hasFiles(e) { return [...(e.dataTransfer?.types || [])].includes("Files"); }
function initDrop() {
  const dz = $("#dropzone");
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dz.classList.add("on"); });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dz.classList.remove("on"); });
  window.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dz.classList.remove("on");
    const items = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    const files = items.length ? (await Promise.all(items.map((it) => readEntry(it, "")))).flat() : [...e.dataTransfer.files].map((f) => ({ file: f, path: f.name }));
    uploadFiles(files);
  });
}
async function readEntry(entry, prefix) {
  if (entry.isFile) return [{ file: await new Promise((res, rej) => entry.file(res, rej)), path: prefix + entry.name }];
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const out = [];
  let batch;
  do {
    batch = await new Promise((res) => reader.readEntries(res, () => res([])));
    for (const ent of batch) out.push(...(await readEntry(ent, `${prefix}${entry.name}/`)));
  } while (batch.length);
  return out;
}

export function pickFiles() { $("#file-input").click(); }
export function pickFolder() { $("#folder-input").click(); }

// One place that answers "how do I add games?": a drop target, pickers, and where the drop
// folder is on disk (with a button to open it in the desktop app).
export function addGamesSheet() {
  const lib = store.state.library;
  const target = h("div.add-drop", { "data-nav": "", tabindex: "0", onclick: () => pickFiles(), onkeydown: (e) => { if (e.key === "Enter") pickFiles(); } },
    ic("upload"), h("b", "Drag games here"), h("span", "or anywhere on this window. Any console, zipped or not, single files or whole folders."));
  target.addEventListener("dragover", (e) => { if (hasFiles(e)) target.classList.add("over"); });
  target.addEventListener("dragleave", () => target.classList.remove("over"));
  target.addEventListener("drop", () => { target.classList.remove("over"); setTimeout(() => s.close(), 50); });
  const body = h("div",
    target,
    h("div.add-actions",
      h("button.btn", { "data-nav": "", onclick: () => { s.close(); pickFiles(); } }, ic("upload"), "Choose files…"),
      h("button.btn", { "data-nav": "", onclick: () => { s.close(); pickFolder(); } }, ic("folder"), "Choose a folder…"),
      h("button.btn", { "data-nav": "", onclick: () => { s.close(); freeGamesSheet(); } }, ic("gift"), "Get free games")),
    h("div.add-folder",
      h("div.grow",
        h("div.k", "Your drop folder"),
        h("div.v", lib.dropFolder),
        h("div.d", "Copy or move games into this folder in your file manager and Phosphor sorts them into the right console automatically.")),
      window.phosphorDesktop
        ? h("button.btn.small", { "data-nav": "", onclick: () => window.phosphorDesktop.openFolder("Drop Games Here") }, ic("folder"), "Open folder")
        : h("button.btn.small", { "data-nav": "", onclick: () => { navigator.clipboard?.writeText(lib.dropFolder); toast({ title: "Folder path copied", icon: "check", kind: "good" }); } }, "Copy path")),
    h("p", { style: { color: "var(--text-3)", fontSize: "13px", margin: "14px 0 0" } }, "Want to see every console's folder? ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); s.close(); import("./views/library.js").then((m) => m.folderSheet()); } }, "Where do games go?")));
  const s = sheet({ title: "Add games", body, wide: true });
}

let uploading = false;
const queue = [];
export function uploadFiles(files) {
  files = files.filter((f) => !f.path.split("/").some((p) => p.startsWith(".")));
  if (!files.length) return;
  queue.push(...files);
  if (!uploading) runUploads();
}
async function runUploads() {
  uploading = true;
  let cancelled = false;
  let xhr = null;
  const cancelBtn = h("button.up-cancel", { onclick: () => { cancelled = true; queue.length = 0; xhr?.abort(); } }, "Cancel");
  const panel = h("div.uploads",
    h("h4", h("span#up-title", "Adding games"), h("span#up-pct", "")),
    h("div.bar", h("i#up-bar")),
    h("div.up-stats", h("span#up-bytes", ""), h("span#up-eta", "")),
    h("div.file#up-file"),
    h("div.up-foot", h("span#up-count", ""), cancelBtn));
  document.body.append(panel);
  let done = 0, failed = 0, bytesDone = 0, since = 0;
  const total = () => queue.reduce((a, f) => a + f.file.size, 0) + bytesDone + (current?.file.size || 0);
  let current = null;
  // Speed from the last few seconds, so the estimate settles instead of jumping around.
  const samples = [];
  const show = (fileBytes) => {
    const all = total();
    const now = bytesDone + fileBytes;
    const pct = all ? Math.min(100, (now / all) * 100) : 0;
    $("#up-bar", panel).style.width = `${pct}%`;
    $("#up-pct", panel).textContent = `${Math.floor(pct)}%`;
    const t = performance.now();
    samples.push([t, now]);
    while (samples.length > 2 && t - samples[0][0] > 4000) samples.shift();
    const [t0, b0] = samples[0];
    const speed = t - t0 > 500 ? ((now - b0) / (t - t0)) * 1000 : 0;
    $("#up-bytes", panel).textContent = `${fmtBytes(now)} of ${fmtBytes(all)}`;
    const left = speed > 0 ? (all - now) / speed : 0;
    $("#up-eta", panel).textContent = speed > 0 ? `${fmtBytes(speed)}/s · ${left < 60 ? `${Math.max(1, Math.round(left))} s` : `${Math.round(left / 60)} min`} left` : "";
  };
  while (queue.length && !cancelled) {
    const item = queue.shift();
    current = item;
    $("#up-file", panel).textContent = item.path;
    $("#up-count", panel).textContent = `File ${done + failed + 1} of ${done + failed + queue.length + 1}`;
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    // The server reports what it has really written; the browser's own number is only a fallback.
    let serverBytes = 0, clientBytes = 0, finished = false;
    const poll = setInterval(async () => {
      try {
        const r = await api.get(`/api/upload/progress?id=${encodeURIComponent(id)}`);
        if (finished) return; // answer to a poll sent before this file finished
        serverBytes = Math.max(serverBytes, r.written || 0);
        show(serverBytes);
      } catch { /* next tick */ }
    }, 400);
    try {
      await new Promise((resolve, reject) => {
        xhr = new XMLHttpRequest();
        xhr.open("PUT", `/api/upload?id=${encodeURIComponent(id)}&path=${encodeURIComponent(item.path)}`);
        if (getProfile()) xhr.setRequestHeader("x-profile", String(getProfile()));
        xhr.upload.onprogress = (ev) => { clientBytes = ev.loaded; if (!serverBytes) show(Math.min(clientBytes, item.file.size * 0.02)); };
        xhr.onload = () => {
          if (xhr.status >= 300) return reject(new Error(xhr.responseText));
          try { const at = JSON.parse(xhr.responseText).at; if (at && (!since || at < since)) since = at; } catch { /* older server */ }
          resolve();
        };
        xhr.onerror = () => reject(new Error("network error"));
        xhr.onabort = () => reject(new Error("cancelled"));
        xhr.send(item.file);
      });
      done++;
    } catch { if (!cancelled) failed++; }
    finished = true;
    clearInterval(poll);
    bytesDone += item.file.size;
    current = null;
    show(0);
  }
  cancelBtn.remove();
  $("#up-eta", panel).textContent = "";
  if (cancelled) {
    $("#up-title", panel).textContent = done ? `Stopped after ${plural(done, "file")}` : "Upload cancelled";
    $("#up-file", panel).textContent = done ? "Sorting the finished ones into your library…" : "";
  } else {
    $("#up-title", panel).textContent = failed ? `${done} added, ${failed} failed` : `Copied ${plural(done, "file")}`;
    $("#up-file", panel).textContent = "Sorting them into your library…";
    $("#up-bar", panel).style.width = "100%";
    $("#up-pct", panel).textContent = "100%";
  }
  $("#up-count", panel).textContent = "";
  uploading = false;
  if (!done) { setTimeout(() => panel.remove(), 2500); return; }
  // Say where the games went once the library has sorted them.
  try {
    const scan = await api.post(`/api/library/scan?wait=1&since=${since}`);
    const added = scan?.added ?? 0;
    $("#up-title", panel).textContent = added ? `Added ${plural(added, "game")}` : scan?.unknown?.length ? "Copied, but not recognised" : "Copied: already in your library";
    $("#up-file", panel).textContent = added ? "They're in your library now." : scan?.unknown?.length ? "They're still in the drop folder (see Settings › Library)." : "Nothing new to add.";
  } catch { /* the library event toast covers it */ }
  setTimeout(() => panel.remove(), 5000);
}

// ---------- attract mode (screensaver) ----------
let lastActivity = Date.now();
let saver = null;
function activity() {
  lastActivity = Date.now();
  if (saver) stopSaver();
}
function initScreensaver() {
  for (const ev of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, activity, { passive: true, capture: true });
  onActivity(activity);
  setInterval(() => {
    const mins = store.settings.screensaver ?? 5;
    if (!mins || saver || document.hidden || sheetOpen() || $("#dropzone.on") || $(".uploads")) return;
    if (Date.now() - lastActivity > mins * 60000) startSaver();
  }, 5000);
}
async function startSaver() {
  const games = (await api.get("/api/games").catch(() => [])).filter((g) => g.snap || g.titleArt || g.box);
  if (!games.length || saver) return;
  for (let i = games.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [games[i], games[j]] = [games[j], games[i]]; }
  const el = h("div#saver", h("div.saver-hint", "Press any button"));
  document.body.append(el);
  let i = 0;
  const show = () => {
    const g = games[i++ % games.length];
    const sys = store.systems[g.system];
    const src = g.snap || g.titleArt || g.box;
    const slide = h("div.slide", h("div.sbg", { style: { backgroundImage: `url("${src}")` } }), h("img.shot", { src, alt: "" }),
      h("div.cap", g.box ? h("img.box", { src: g.box, alt: "" }) : null, h("div", h("div.sys", sys?.name || ""), h("div.t", g.title), g.year ? h("div.y", String(g.year)) : null)));
    const img = slide.querySelector("img.shot");
    img.addEventListener("load", () => { const c = imageColor(img); if (c) setAmbient([c, sys?.color || "#4b2fd6", "#0b0c12"]); }, { once: true });
    el.append(slide);
    requestAnimationFrame(() => slide.classList.add("in"));
    const old = el.querySelectorAll(".slide");
    if (old.length > 2) old[0].remove();
  };
  show();
  saver = { el, timer: setInterval(show, 8000) };
}
function stopSaver() {
  clearInterval(saver.timer);
  saver.el.remove();
  saver = null;
}

// ---------- boot ----------
async function boot() {
  buildShell();
  initNav();
  setNavHandlers({
    back: () => { if (closeTopSheet()) return; if (document.querySelector(".who")) return; if (location.pathname !== "/") history.back(); },
    search: () => { if (!sheetOpen()) navigate("/search"); },
    section: (dir) => {
      const ids = NAV.map((n) => n.id);
      const cur = $(".rail-btn.active")?.dataset.id || "home";
      const next = NAV[(ids.indexOf(cur) + dir + ids.length) % ids.length];
      navigate(next.href);
    },
    menu: () => profileSheet(),
  });
  try {
    await refreshState();
  } catch (e) {
    $("#view").append(h("div.page", h("div.empty-state", h("h2", "Can't reach Phosphor"), h("p", e.message), h("button.btn", { onclick: () => location.reload() }, "Retry"))));
    return;
  }
  document.body.classList.toggle("reduce-motion", !!store.settings.reduceMotion);
  sound.set(store.settings.sounds !== false && localStorage.getItem("phosphor.sounds") !== "off");
  updateRail();
  initDrop();
  connectEvents();
  await render();
  whoIsPlaying();
  initScreensaver();
  initUpdates();
  window.addEventListener("pageshow", (e) => { if (e.persisted) { document.body.style.opacity = "1"; render(); } });
}

window.phosphor = { navigate, uploadFiles, pickFiles, pickFolder, addGamesSheet, profileSheet, leaveTo, svg };
boot();
