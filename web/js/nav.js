// Couch mode: arrow keys and any game controller drive the whole interface with spatial
// navigation (A select, B back, X favourite, Y search, LB/RB switch sections).
import { sound } from "./sound.js";

const SELECTOR = '[data-nav], .btn, a[href], button:not([tabindex="-1"]), input, select, textarea, [tabindex="0"]';
let handlers = { back: () => history.back(), search: () => {}, section: () => {}, menu: () => {} };
export const setNavHandlers = (h) => { handlers = { ...handlers, ...h }; };
let activityHook = () => {};
export const onActivity = (fn) => { activityHook = fn; };

function layerRoot() {
  const who = document.querySelector(".who");
  if (who) return who;
  const overlays = document.querySelectorAll(".overlay");
  return overlays.length ? overlays[overlays.length - 1] : document.body;
}

function visible(el) {
  if (el.disabled || el.closest("[inert]") || el.getAttribute("aria-hidden") === "true") return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== "hidden" && st.display !== "none";
}

export function focusables(root = layerRoot()) {
  return [...root.querySelectorAll(SELECTOR)].filter((el) => !el.closest("#hints") && visible(el));
}

function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

export function move(dir) {
  const items = focusables();
  if (!items.length) return;
  let cur = document.activeElement;
  if (!cur || cur === document.body || !items.includes(cur)) {
    const first = items.find((el) => el.closest("main")) || items[0];
    focusEl(first);
    return;
  }
  const cr = cur.getBoundingClientRect();
  const cc = center(cr);
  let best = null;
  let bestScore = Infinity;
  const region = (el) => (el.closest(".rail") ? "rail" : "main");
  const curRegion = region(cur);
  for (const el of items) {
    if (el === cur || el.contains(cur) || cur.contains(el)) continue;
    const r = el.getBoundingClientRect();
    const c = center(r);
    // A candidate must lie clearly beyond the current element in that direction.
    const tolV = Math.min(cr.height, r.height) * 0.3, tolH = Math.min(cr.width, r.width) * 0.3;
    let primary, secondary, overlap;
    if (dir === "right") { if (r.left < cr.right - tolH) continue; primary = r.left - cr.right; secondary = Math.abs(c.y - cc.y); overlap = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top); }
    else if (dir === "left") { if (r.right > cr.left + tolH) continue; primary = cr.left - r.right; secondary = Math.abs(c.y - cc.y); overlap = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top); }
    else if (dir === "down") { if (r.top < cr.bottom - tolV) continue; primary = r.top - cr.bottom; secondary = Math.abs(c.x - cc.x); overlap = Math.min(r.right, cr.right) - Math.max(r.left, cr.left); }
    else { if (r.bottom > cr.top + tolV) continue; primary = cr.top - r.bottom; secondary = Math.abs(c.x - cc.x); overlap = Math.min(r.right, cr.right) - Math.max(r.left, cr.left); }
    let score = Math.max(0, primary) + secondary * (overlap > 0 ? 0.6 : 2.4);
    // Up/down stays in its column (the rail or the page); left/right crosses between them.
    if ((dir === "up" || dir === "down") && region(el) !== curRegion) continue;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { focusEl(best); sound.play("move"); }
}

export function focusEl(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const inScroller = el.closest(".scroller");
  el.scrollIntoView({ block: inScroller ? "nearest" : "center", inline: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function isTyping(el) {
  return el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "range"].includes(el.type)) || el.isContentEditable);
}

export function initNav() {
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const typing = isTyping(document.activeElement);
    const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    if (map[e.key]) {
      if (typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      if (document.activeElement?.tagName === "SELECT") return;
      e.preventDefault();
      setPadMode(false);
      move(map[e.key]);
    } else if (e.key === "Escape" || (e.key === "Backspace" && !typing)) {
      e.preventDefault();
      sound.play("back");
      handlers.back();
    } else if (e.key === "/" && !typing) {
      e.preventDefault();
      handlers.search();
    }
  });
  document.addEventListener("mousemove", () => setPadMode(false), { passive: true });
  pollPads();
}

export function setPadMode(on) {
  if (document.body.classList.contains("pad") === on) return;
  document.body.classList.toggle("pad", on);
}

// ---------- controllers ----------
const held = new Map(); // key -> { since, last }
const REPEAT_DELAY = 380, REPEAT_RATE = 85;
function pressed(key, isDown, now, fire, repeat = false) {
  const h = held.get(key);
  if (!isDown) { held.delete(key); return; }
  if (!h) { held.set(key, { since: now, last: now }); fire(); return; }
  if (repeat && now - h.since > REPEAT_DELAY && now - h.last > REPEAT_RATE) { h.last = now; fire(); }
}

// Polls on a steady timer (not animation frames, which browsers throttle on idle pages), and only
// while a controller is connected.
function pollPads() {
  let timer = null;
  const tick = () => {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const now = performance.now();
    if (!pads.length || document.hidden) return;
    const b = (i) => pads.some((p) => p.buttons[i]?.pressed);
    const ax = (i) => pads.reduce((acc, p) => (Math.abs(p.axes[i] || 0) > Math.abs(acc) ? p.axes[i] : acc), 0);
    const dirs = { up: b(12) || ax(1) < -0.6, down: b(13) || ax(1) > 0.6, left: b(14) || ax(0) < -0.6, right: b(15) || ax(0) > 0.6 };
    const any = Object.values(dirs).some(Boolean) || [0, 1, 2, 3, 4, 5, 8, 9].some(b);
    if (any) { setPadMode(true); activityHook(); }
    for (const [dir, on] of Object.entries(dirs)) pressed(`d-${dir}`, on, now, () => move(dir), true);
    pressed("a", b(0), now, () => {
      const el = document.activeElement;
      if (el && el !== document.body) { el.click(); if (el.tagName === "INPUT") el.focus(); }
      else move("down");
    });
    pressed("b", b(1), now, () => { sound.play("back"); handlers.back(); });
    pressed("x", b(2), now, () => document.activeElement?.dispatchEvent(new CustomEvent("pad-x", { bubbles: true })));
    pressed("y", b(3), now, () => handlers.search());
    pressed("lb", b(4), now, () => handlers.section(-1));
    pressed("rb", b(5), now, () => handlers.section(1));
    pressed("start", b(9), now, () => handlers.menu());
  };
  const start = () => { if (!timer) timer = setInterval(tick, 16); };
  window.addEventListener("gamepadconnected", start);
  setInterval(() => {
    const has = navigator.getGamepads && [...navigator.getGamepads()].some(Boolean);
    if (has) start();
    else if (timer) { clearInterval(timer); timer = null; held.clear(); }
  }, 500);
}
