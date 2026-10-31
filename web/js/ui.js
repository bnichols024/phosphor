// UI toolkit: element builder, toasts, sheets, game cards, colour extraction, formatting.
import { icon, consoleIcon } from "./icons.js";
import { sound } from "./sound.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h("div.card#id", { onclick, style: {...}, dataset: {...} }, children...)
export function h(tag, attrs, ...children) {
  const [, name = "div", rest = ""] = /^([a-z0-9-]+)?(.*)$/i.exec(tag);
  const el = document.createElement(name);
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === ".") el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "class") el.className = [el.className, v].filter(Boolean).join(" ");
    else if (k.startsWith("--")) el.style.setProperty(k, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const svg = (markup) => { const t = document.createElement("template"); t.innerHTML = markup.trim(); return t.content.firstChild; };
export const ic = (name) => svg(icon(name));
// A console's picture: the real controller/device photo, or the drawn icon if there's no photo.
export function consoleArt(sys, cls = "ico") {
  if (sys?.photo) {
    const img = h("img", { class: `${cls} photo`, src: sys.photo, alt: "", draggable: "false", decoding: "async" });
    img.addEventListener("error", () => img.replaceWith(consoleArt({ ...sys, photo: null }, cls)), { once: true });
    return img;
  }
  const el = svg(consoleIcon(sys?.icon));
  el.classList.add(...cls.split(" "));
  return el;
}

// ---------- formatting ----------
export function fmtTime(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return sec ? `${sec}s` : "0m";
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const hh = Math.floor(m / 60);
  return `${hh}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
}
export function timeAgo(ms) {
  if (!ms) return "";
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 2) return "yesterday";
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
export function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
export const plural = (n, word, pl = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : pl}`;

// ---------- toasts ----------
export function toast({ title, text = "", icon: iconName = "info", img = null, kind = "", timeout = 4200 }) {
  let host = $("#toasts");
  if (!host) { host = h("div#toasts"); document.body.append(host); }
  const t = h("div.toast", { class: kind, role: "status" },
    h("div.ti", img ? h("img", { src: img, alt: "" }) : ic(iconName)),
    h("div", h("b", title), text ? h("span", text) : null));
  host.append(t);
  while (host.children.length > 4) host.firstChild.remove();
  const close = () => { t.classList.add("out"); setTimeout(() => t.remove(), 250); };
  if (timeout) setTimeout(close, timeout);
  t.addEventListener("click", close);
  return close;
}
export const toastError = (e, title = "Something went wrong") => { sound.play("error"); toast({ title, text: e?.message || String(e), icon: "alert", kind: "bad", timeout: 6000 }); };

// ---------- sheets (modal dialogs) ----------
const sheetStack = [];
export function sheet({ title, sub, body, actions = [], wide = false, onClose }) {
  const prevFocus = document.activeElement;
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const ov = h("div.overlay", { role: "dialog", "aria-modal": "true" });
  const box = h("div.sheet", { style: wide ? { width: "min(820px, 100%)" } : null },
    title ? h("h2", title) : null,
    sub ? h("p.sub", sub) : null,
    body || null);
  const close = (value) => {
    if (!ov.isConnected) return;
    ov.remove();
    sheetStack.splice(sheetStack.indexOf(close), 1);
    onClose?.(value);
    resolve(value);
    prevFocus?.focus?.({ preventScroll: true });
  };
  if (actions.length) {
    box.append(h("div.actions", actions.map((a) => h("button.btn", {
      class: a.kind || "", "data-nav": "",
      onclick: async () => { if (a.onClick) { const r = await a.onClick(); if (r === false) return; } close(a.value); },
    }, a.icon ? ic(a.icon) : null, a.label))));
  }
  ov.append(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) close(undefined); });
  document.body.append(ov);
  sheetStack.push(close);
  setTimeout(() => (box.querySelector("[autofocus]") || box.querySelector("input, .btn.primary, .btn.accent, [data-nav], button"))?.focus(), 30);
  return { el: box, close, done };
}
export const closeTopSheet = () => { const c = sheetStack[sheetStack.length - 1]; if (c) { c(undefined); return true; } return false; };
export const sheetOpen = () => sheetStack.length > 0;

export function confirmBox(title, text, { ok = "OK", danger = false } = {}) {
  return sheet({ title, sub: text, actions: [{ label: "Cancel", kind: "ghost", value: false }, { label: ok, kind: danger ? "accent danger" : "primary", value: true }] }).done.then(Boolean);
}
export function promptBox(title, { value = "", placeholder = "", ok = "Save" } = {}) {
  const input = h("input.text", { value, placeholder, autofocus: true });
  let result = null;
  const s = sheet({ title, body: input, actions: [{ label: "Cancel", kind: "ghost" }, { label: ok, kind: "primary", onClick: () => { result = input.value; } }] });
  // preventDefault: otherwise this Enter also "clicks" whatever button gets focus back.
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); result = input.value; s.close(); } });
  return s.done.then(() => result);
}

// ---------- colour ----------
const colorCache = new Map(JSON.parse(sessionStorage.getItem("phosphor.colors") || "[]"));
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [124, 92, 255];
}
// Most vivid average colour of an image (for the ambient glow behind it).
export function imageColor(img) {
  if (!img?.src) return null;
  if (colorCache.has(img.src)) return colorCache.get(img.src);
  try {
    const c = document.createElement("canvas");
    c.width = 24; c.height = 24;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, 24, 24);
    const px = g.getImageData(0, 0, 24, 24).data;
    let best = null;
    const buckets = new Map();
    for (let i = 0; i < px.length; i += 4) {
      const [r, gg, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      if (a < 200) continue;
      const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
      const sat = max ? (max - min) / max : 0;
      if (max < 40 || sat < 0.25) continue;
      const key = `${r >> 5}-${gg >> 5}-${b >> 5}`;
      const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, sat: 0 };
      e.n++; e.r += r; e.g += gg; e.b += b; e.sat += sat;
      buckets.set(key, e);
    }
    for (const e of buckets.values()) { const score = e.n * (e.sat / e.n); if (!best || score > best.score) best = { score, rgb: [e.r / e.n, e.g / e.n, e.b / e.n].map(Math.round) }; }
    const rgb = best?.rgb || null;
    colorCache.set(img.src, rgb);
    if (colorCache.size < 400) sessionStorage.setItem("phosphor.colors", JSON.stringify([...colorCache]));
    return rgb;
  } catch { return null; }
}
let ambientTimer;
export function setAmbient(colors) {
  clearTimeout(ambientTimer);
  ambientTimer = setTimeout(() => {
    const amb = $("#ambient");
    if (!amb) return;
    const [a, b, c] = colors.map((x) => (Array.isArray(x) ? `rgb(${x.join(",")})` : x));
    amb.style.setProperty("--amb-1", a || "#4b2fd6");
    amb.style.setProperty("--amb-2", b || a || "#0e7d74");
    amb.style.setProperty("--amb-3", c || b || a || "#2b1b5e");
  }, 60);
}
export function setAccent(hex) {
  const [r, g, b] = hexToRgb(hex);
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
}

// ---------- game cards ----------
export function coverGen(game, sys) {
  return h("div.cover-gen", { "--sys": sys?.color || "#7c5cff" },
    consoleArt(sys),
    h("div.t", game.title),
    h("div.s", sys?.short || ""));
}
const genCover = coverGen;

export function artImage(src, alt = "") {
  const img = h("img.art", { src, alt, loading: "lazy", decoding: "async", draggable: "false" });
  img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
  img.addEventListener("error", () => img.remove(), { once: true });
  return img;
}

export function gameCard(game, { systems, onOpen, ratio, showSystem = true, resumable = false } = {}) {
  const sys = systems?.[game.system];
  const art = h("div.gcard-art");
  if (game.box) {
    art.append(h("div.bg", { style: { backgroundImage: `url("${game.box}")` } }));
    const img = artImage(game.box, "");
    img.addEventListener("load", () => {
      const rgb = imageColor(img);
      if (rgb) card.style.setProperty("--glow-rgb", rgb.join(","));
    }, { once: true });
    art.append(img);
  } else {
    art.append(genCover(game, sys));
  }
  const badges = h("div.badges",
    game.region && game.region !== "US" && game.region !== "World" ? h("span.region", game.region) : null,
    h("div.right", game.favorite ? h("span.fav", ic("heartFill")) : null));
  art.append(badges, h("div.play-hint", h("span", ic("play"))));
  if (resumable) art.append(h("div.resume", ic("resume"), game.lastPlayed ? `Resume · ${timeAgo(game.lastPlayed)}` : "Resume"));
  const sub = [showSystem ? sys?.short : null, game.year].filter(Boolean).join(" · ") || (game.genre || "");
  const card = h("button.gcard", {
    "data-nav": "", "data-game-id": game.id, "--ar": ratio || 0.75, "aria-label": game.title,
    onclick: () => { sound.play("select"); onOpen ? onOpen(game) : location.assign(`/game/${game.id}`); },
  }, art, h("div.gcard-meta", h("span.gcard-title", game.title), h("span.gcard-sub", sub)));
  if (sys) card.style.setProperty("--glow-rgb", hexToRgb(sys.color).join(","));
  attachTilt(card, art);
  return card;
}

// Gentle 3D tilt + glare that follows the pointer (mouse only).
export function attachTilt(card, art) {
  card.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const r = art.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    art.style.setProperty("--ry", `${(x - 0.5) * 10}deg`);
    art.style.setProperty("--rx", `${(0.5 - y) * 10}deg`);
    art.style.setProperty("--mx", `${x * 100}%`);
    art.style.setProperty("--my", `${y * 100}%`);
  });
  card.addEventListener("pointerleave", () => { art.style.removeProperty("--rx"); art.style.removeProperty("--ry"); });
}

export function row(title, items, { more, count, wide = false } = {}) {
  if (!items.length) return null;
  return h("section.row",
    h("div.row-head", h("h2", title), count ? h("span.count", count) : null, more ? h("a.more", { href: more.href, "data-nav": "" }, more.label || "See all") : null),
    h("div.scroller", { class: wide ? "wide" : "" }, items));
}

export function emptyState({ iconSvg, art, title, text, actions = [] }) {
  return h("div.empty-state",
    art ? h("div.big-ico.photo-wrap", art) : iconSvg ? h("div.big-ico", { html: iconSvg }) : null,
    h("h2", title), h("p", text),
    actions.length ? h("div", { style: { display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" } }, actions) : null);
}
