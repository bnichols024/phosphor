// Phone controller: joins a game room over WebSocket and sends button presses as RetroPad inputs.
// RetroPad ids: B0 Y1 Select2 Start3 Up4 Down5 Left6 Right7 A8 X9 L10 R11 L2:12 R2:13, stick 16-19, right stick 20-23.
const RED = "#e5383b", BLUE = "#3a86ff", GREEN = "#2a9d8f", YELLOW = "#f4a261", GREY = "#4a4e63", PINK = "#ff8fab", PURPLE = "#7b5cff";
const P2 = (b, a, lb = "B", la = "A", cb = RED, ca = RED) => [{ l: lb, i: b, c: cb, x: 8, y: 52 }, { l: la, i: a, c: ca, x: 56, y: 22 }];
const DIAMOND = (top, right, bottom, left) => [{ ...top, x: 32, y: 0 }, { ...right, x: 64, y: 32 }, { ...bottom, x: 32, y: 64 }, { ...left, x: 0, y: 32 }];
const ROW3 = (a, b, c, y = 50) => [{ ...a, x: 0, y: y + 8 }, { ...b, x: 32, y }, { ...c, x: 64, y: y - 8 }];

const LAYOUTS = {
  nes: { face: P2(0, 8), meta: [["SELECT", 2], ["START", 3]] },
  gb: { face: P2(0, 8, "B", "A", PURPLE, PURPLE), meta: [["SELECT", 2], ["START", 3]] },
  gba: { face: P2(0, 8, "B", "A", PURPLE, PURPLE), sh: [["L", 10], ["R", 11]], meta: [["SELECT", 2], ["START", 3]] },
  snes: { face: DIAMOND({ l: "X", i: 9, c: BLUE }, { l: "A", i: 8, c: RED }, { l: "B", i: 0, c: YELLOW }, { l: "Y", i: 1, c: GREEN }), sh: [["L", 10], ["R", 11]], meta: [["SELECT", 2], ["START", 3]] },
  nds: { face: DIAMOND({ l: "X", i: 9, c: GREY }, { l: "A", i: 8, c: GREY }, { l: "B", i: 0, c: GREY }, { l: "Y", i: 1, c: GREY }), sh: [["L", 10], ["R", 11]], meta: [["SELECT", 2], ["START", 3]] },
  n64: { stick: true, face: [{ l: "B", i: 1, c: GREEN, x: 4, y: 40 }, { l: "A", i: 0, c: BLUE, x: 30, y: 64 }, { l: "C↑", i: 23, c: YELLOW, x: 56, y: 4, v: 0x7fff, small: true }, { l: "C←", i: 21, c: YELLOW, x: 40, y: 26, v: 0x7fff, small: true }, { l: "C→", i: 20, c: YELLOW, x: 72, y: 26, v: 0x7fff, small: true }, { l: "C↓", i: 22, c: YELLOW, x: 56, y: 48, v: 0x7fff, small: true }], sh: [["L", 10], ["R", 11], ["Z", 12]], meta: [["START", 3]] },
  vb: { face: P2(0, 8), sh: [["L", 10], ["R", 11]], meta: [["SELECT", 2], ["START", 3]] },
  sms: { face: P2(0, 8, "1", "2", GREY, GREY), meta: [["PAUSE", 3]] },
  genesis: { face: [...ROW3({ l: "A", i: 1, c: GREY }, { l: "B", i: 0, c: GREY }, { l: "C", i: 8, c: GREY }, 58), ...ROW3({ l: "X", i: 10, c: "#30333f", small: true }, { l: "Y", i: 9, c: "#30333f", small: true }, { l: "Z", i: 11, c: "#30333f", small: true }, 12)], meta: [["MODE", 2], ["START", 3]] },
  saturn: { face: [...ROW3({ l: "A", i: 0, c: GREY }, { l: "B", i: 8, c: GREY }, { l: "C", i: 11, c: GREY }, 58), ...ROW3({ l: "X", i: 1, c: "#30333f", small: true }, { l: "Y", i: 9, c: "#30333f", small: true }, { l: "Z", i: 10, c: "#30333f", small: true }, 12)], sh: [["L", 12], ["R", 13]], meta: [["START", 3]] },
  psx: { face: DIAMOND({ l: "△", i: 9, c: GREEN }, { l: "○", i: 8, c: RED }, { l: "✕", i: 0, c: BLUE }, { l: "□", i: 1, c: PINK }), sh: [["L1", 10], ["R1", 11], ["L2", 12], ["R2", 13]], meta: [["SELECT", 2], ["START", 3]] },
  psp: { stick: true, face: DIAMOND({ l: "△", i: 9, c: GREEN }, { l: "○", i: 8, c: RED }, { l: "✕", i: 0, c: BLUE }, { l: "□", i: 1, c: PINK }), sh: [["L", 10], ["R", 11]], meta: [["SELECT", 2], ["START", 3]] },
  atari: { face: [{ l: "FIRE", i: 0, c: RED, x: 32, y: 32, big: true }], meta: [["SELECT", 2], ["RESET", 3]] },
  atari5200: { face: P2(0, 8, "1", "2", RED, RED), meta: [["PAUSE", 2], ["START", 3]] },
  atari7800: { face: P2(0, 8, "1", "2", RED, RED), meta: [["SELECT", 2], ["PAUSE", 3]] },
  jaguar: { face: ROW3({ l: "A", i: 1, c: RED }, { l: "B", i: 0, c: RED }, { l: "C", i: 8, c: RED }), meta: [["PAUSE", 2], ["OPTION", 3]] },
  lynx: { face: P2(0, 8), sh: [["OPT1", 10], ["OPT2", 11]], meta: [["PAUSE", 3]] },
  pce: { face: P2(0, 8, "II", "I", GREY, GREY), meta: [["SELECT", 2], ["RUN", 3]] },
  ngp: { face: P2(0, 8, "A", "B", GREY, GREY), meta: [["OPTION", 3]] },
  ws: { face: P2(0, 8, "B", "A", GREY, GREY), meta: [["START", 3]] },
  coleco: { face: P2(0, 8, "L", "R", RED, RED), meta: [["1", 2], ["2", 3]] },
  "3do": { face: ROW3({ l: "A", i: 1, c: GREY }, { l: "B", i: 0, c: GREY }, { l: "C", i: 8, c: GREY }), sh: [["L", 10], ["R", 11]], meta: [["X", 2], ["P", 3]] },
  arcade: { face: [{ l: "1", i: 0, c: RED, x: 0, y: 56 }, { l: "2", i: 8, c: BLUE, x: 32, y: 50 }, { l: "3", i: 1, c: YELLOW, x: 64, y: 44 }, { l: "4", i: 9, c: GREEN, x: 0, y: 14 }, { l: "5", i: 10, c: PURPLE, x: 32, y: 8 }, { l: "6", i: 11, c: PINK, x: 64, y: 2 }], meta: [["COIN", 2], ["START", 3]] },
  c64: { face: [{ l: "FIRE", i: 0, c: RED, x: 32, y: 32, big: true }], meta: [["F1", 2], ["SPACE", 3]] },
  amiga: { face: P2(0, 8, "FIRE", "2", RED, GREY), meta: [["", 2], ["START", 3]] },
  dos: { face: DIAMOND({ l: "X", i: 9, c: GREY }, { l: "A", i: 8, c: GREY }, { l: "B", i: 0, c: GREY }, { l: "Y", i: 1, c: GREY }), sh: [["L", 10], ["R", 11]], meta: [["SELECT", 2], ["START", 3]] },
  zx: { face: [{ l: "FIRE", i: 0, c: RED, x: 32, y: 32, big: true }], meta: [["", 2], ["START", 3]] },
  cpc: { face: P2(0, 8, "FIRE", "2", RED, GREY), meta: [["", 2], ["START", 3]] },
};

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
let ws = null;
let player = null;
const pressed = new Map(); // input id -> count of pointers holding it

// ---------- joining ----------
const digits = [...document.querySelectorAll(".digits input")];
digits.forEach((d, i) => {
  d.addEventListener("input", () => { d.value = d.value.replace(/\D/g, "").slice(-1); if (d.value && digits[i + 1]) digits[i + 1].focus(); if (digits.every((x) => x.value)) join(digits.map((x) => x.value).join("")); });
  d.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !d.value && digits[i - 1]) digits[i - 1].focus(); });
});
$("#go").addEventListener("click", () => join(digits.map((x) => x.value).join("")));
if (params.get("room")) join(params.get("room"));
else setTimeout(() => digits[0].focus(), 100);

function join(code) {
  if (!/^\d{4,6}$/.test(code)) { $("#err").textContent = "Enter the 4 numbers from the TV."; return; }
  $("#err").textContent = "";
  const name = localStorage.getItem("phosphor.padname") || (/iPhone/.test(navigator.userAgent) ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : "Phone");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/pad?role=pad&room=${code}&name=${encodeURIComponent(name)}`);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "joined") { player = m.player; showPad(m.pad, m.title); history.replaceState(null, "", `/pad?room=${code}`); }
    else if (m.type === "layout") showPad(m.pad, m.title);
    else if (m.type === "error") { $("#err").textContent = m.message; $("#join").style.display = ""; $("#pad").classList.remove("on"); }
    else if (m.type === "ended") { $("#err").textContent = "The game was closed. Start another and scan again."; $("#join").style.display = ""; $("#pad").classList.remove("on"); }
    else if (m.type === "rumble") navigator.vibrate?.(m.ms);
  };
  ws.onclose = () => { $(".who")?.classList.add("off"); };
}

function send(changes) { if (ws?.readyState === 1 && changes.length) ws.send(JSON.stringify(changes)); }
function press(id, on, value = 1) {
  const n = (pressed.get(id) || 0) + (on ? 1 : -1);
  if (n <= 0) { pressed.delete(id); send([[id, 0]]); }
  else { if (!pressed.has(id) && on) { send([[id, value]]); navigator.vibrate?.(12); } pressed.set(id, n); }
}

// ---------- drawing the controller ----------
function showPad(padId, title) {
  const L = LAYOUTS[padId] || LAYOUTS.snes;
  const pad = $("#pad");
  $("#join").style.display = "none";
  pad.classList.add("on");
  pad.replaceChildren();
  const bar = h("div", "bar");
  const who = h("div", "who"); who.append(h("i"), `Player ${player + 1}`);
  const menu = h("button", "menu", "MENU");
  menu.addEventListener("click", () => ws?.send(JSON.stringify({ type: "menu" })));
  bar.append(who, menu);
  pad.append(bar, h("div", "title", title || ""));

  // Left: d-pad (8-way, one finger) or analog stick.
  if (L.stick) pad.append(stick());
  else pad.append(dpad());
  // Right: face buttons laid out on a 100x100 grid.
  const face = h("div", "face");
  for (const b of L.face) {
    const size = b.big ? 52 : b.small ? 26 : 36;
    const e = h("div", "btn", b.l);
    e.style.cssText = `--c:${b.c};left:${b.x}%;top:${b.y}%;width:${size}%;height:${size}%;${b.big ? "left:24%;top:24%;" : ""}${b.small ? "font-size:14px;" : ""}`;
    e.dataset.input = b.i;
    if (b.v) e.dataset.value = b.v;
    face.append(e);
  }
  pad.append(face);
  (L.sh || []).forEach(([label, id], i) => {
    const e = h("div", `shoulder ${["l", "r", "l2", "r2"][i] || "r2"}`, label);
    e.dataset.input = id;
    pad.append(e);
  });
  const meta = h("div", "meta");
  for (const [label, id] of L.meta || []) { if (!label) continue; const e = h("div", "pill", label); e.dataset.input = id; meta.append(e); }
  pad.append(meta);
  bindButtons(pad);
  document.documentElement.requestFullscreen?.().catch(() => {});
  navigator.wakeLock?.request?.("screen").catch(() => {});
}

function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

// Buttons: each finger can press, slide onto another button, and release (great for fighters).
function bindButtons(root) {
  const fingers = new Map(); // pointerId -> element
  const at = (x, y) => document.elementFromPoint(x, y)?.closest("[data-input]");
  const set = (pid, elx) => {
    const prev = fingers.get(pid);
    if (prev === elx) return;
    if (prev) { prev.classList.remove("on"); press(Number(prev.dataset.input), false); }
    if (elx) { elx.classList.add("on"); press(Number(elx.dataset.input), true, Number(elx.dataset.value || 1)); fingers.set(pid, elx); }
    else fingers.delete(pid);
  };
  root.addEventListener("pointerdown", (e) => { const t = at(e.clientX, e.clientY); if (t) { e.preventDefault(); set(e.pointerId, t); } });
  root.addEventListener("pointermove", (e) => { if (fingers.has(e.pointerId)) set(e.pointerId, at(e.clientX, e.clientY)); });
  const up = (e) => set(e.pointerId, null);
  root.addEventListener("pointerup", up);
  root.addEventListener("pointercancel", up);
  root.addEventListener("contextmenu", (e) => e.preventDefault());
}

function dpad() {
  const d = h("div", "dpad");
  d.append(h("div", "arm h"), h("div", "arm v"));
  const glows = { 4: [35, 6], 5: [35, 64], 6: [6, 35], 7: [64, 35] };
  const g = {};
  for (const [id, [x, y]] of Object.entries(glows)) { const e = h("div", "glow"); e.style.left = `${x}%`; e.style.top = `${y}%`; d.append(e); g[id] = e; }
  let active = new Set();
  let pid = null;
  const update = (e) => {
    const r = d.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    const next = new Set();
    if (Math.hypot(x, y) > 0.1) {
      const a = Math.atan2(y, x) * 180 / Math.PI; // 8 sectors of 45 degrees
      if (a > -67.5 && a < 67.5) next.add(7);
      if (a > 112.5 || a < -112.5) next.add(6);
      if (a > 22.5 && a < 157.5) next.add(5);
      if (a < -22.5 && a > -157.5) next.add(4);
    }
    const changes = [];
    for (const id of active) if (!next.has(id)) { changes.push([id, 0]); g[id].classList.remove("on"); }
    for (const id of next) if (!active.has(id)) { changes.push([id, 1]); g[id].classList.add("on"); }
    if (changes.some((c) => c[1])) navigator.vibrate?.(8);
    send(changes);
    active = next;
  };
  d.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; d.setPointerCapture(pid); update(e); });
  d.addEventListener("pointermove", (e) => { if (e.pointerId === pid) update(e); });
  const end = (e) => { if (e.pointerId !== pid) return; pid = null; send([...active].map((id) => [id, 0])); active.forEach((id) => g[id].classList.remove("on")); active = new Set(); };
  d.addEventListener("pointerup", end);
  d.addEventListener("pointercancel", end);
  return d;
}

function stick() {
  const s = h("div", "stick");
  const knob = h("div", "knob");
  s.append(knob);
  let pid = null;
  let last = [0, 0, 0, 0];
  const update = (e) => {
    const r = s.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width - 0.5) * 2, y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    knob.style.transform = `translate(${x * 60}%, ${y * 60}%)`;
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    x = dz(x); y = dz(y);
    const vals = [x > 0 ? Math.round(x * 0x7fff) : 0, x < 0 ? Math.round(-x * 0x7fff) : 0, y > 0 ? Math.round(y * 0x7fff) : 0, y < 0 ? Math.round(-y * 0x7fff) : 0];
    const changes = [];
    vals.forEach((v, i) => { if (Math.abs(v - last[i]) > 600 || (v === 0 && last[i] !== 0)) changes.push([16 + i, v]); });
    if (changes.length) { send(changes); changes.forEach(([id, v]) => { last[id - 16] = v; }); }
  };
  s.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; s.setPointerCapture(pid); update(e); });
  s.addEventListener("pointermove", (e) => { if (e.pointerId === pid) update(e); });
  const end = (e) => { if (e.pointerId !== pid) return; pid = null; knob.style.transform = ""; send([[16, 0], [17, 0], [18, 0], [19, 0]]); last = [0, 0, 0, 0]; };
  s.addEventListener("pointerup", end);
  s.addEventListener("pointercancel", end);
  return s;
}
