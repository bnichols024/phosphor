// Screensaver: an old CRT flipping through "channels", one of your games each (title screen,
// gameplay shots, your own screenshots, where you left off), with static between channels, a
// green channel number and a clock. A (or Enter, or the Play button) starts that channel's game;
// anything else wakes the app up.
import { api } from "./api.js";
import { store } from "./store.js";
import { h, ic, $, sheetOpen, imageColor } from "./ui.js";
import { setCapture, onActivity } from "./nav.js";
import { playGame } from "./actions.js";

const CHANNEL_MS = 12000, FRAME_MS = 4000, STATIC_MS = 380;
let lastActivity = Date.now();
let saver = null;

export function initScreensaver() {
  const poke = () => { lastActivity = Date.now(); };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, poke, { passive: true, capture: true });
  window.addEventListener("pointermove", (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) poke(); }, { passive: true, capture: true });
  onActivity(poke);
  setInterval(() => {
    const mins = store.settings.screensaver ?? 5;
    if (!mins || saver || document.hidden || sheetOpen() || $("#dropzone.on") || $(".uploads:not(.update-panel)")) return;
    if (Date.now() - lastActivity > mins * 60000) start();
  }, 5000);
}

// Settings › General › Try it now.
export const startScreensaver = () => start();

async function start() {
  const channels = (await api.get("/api/attract").catch(() => [])).filter((c) => c.frames.length);
  if (!channels.length || saver) return;
  const reduce = document.body.classList.contains("reduce-motion");
  const showClock = store.settings.saverClock !== false;

  const frameA = h("img.crt-frame", { alt: "" }), frameB = h("img.crt-frame", { alt: "" });
  const noise = h("canvas.crt-static", { width: 160, height: 100 });
  const osdCh = h("div.osd-ch");
  const osdClock = h("div.osd-clock");
  const caption = h("div.crt-caption");
  const playBtn = h("button.crt-play", { onclick: (e) => { e.stopPropagation(); play(); } }, h("kbd", "A"), "Play this");
  const screen = h("div.crt-screen", frameA, frameB, noise, h("div.crt-lines"), h("div.crt-vignette"), osdCh, showClock ? osdClock : null, caption);
  const el = h("div#saver.crt", screen, h("div.crt-hint", playBtn, h("span", "Any other button to exit")));
  document.body.append(el);

  let ch = 0, frame = 0, front = frameA, back = frameB;
  const timers = [];
  const now = () => channels[ch % channels.length];

  const clock = () => { osdClock.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
  clock();
  timers.push(setInterval(clock, 15000));

  // Static: random grey noise for a moment, like flipping a real TV.
  const burst = () => new Promise((done) => {
    if (reduce) return done();
    const ctx = noise.getContext("2d");
    const img = ctx.createImageData(noise.width, noise.height);
    const t0 = performance.now();
    noise.classList.add("on");
    screen.classList.add("roll");
    const draw = (t) => {
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      if (t - t0 < STATIC_MS) requestAnimationFrame(draw);
      else { noise.classList.remove("on"); screen.classList.remove("roll"); done(); }
    };
    requestAnimationFrame(draw);
  });

  const showFrame = (src) => {
    back.src = src;
    back.className = `crt-frame ${["pan-a", "pan-b", "pan-c"][Math.floor(Math.random() * 3)]}`;
    back.onload = () => {
      back.classList.add("on");
      front.classList.remove("on");
      const c = imageColor(back);
      if (c) screen.style.setProperty("--glow", c.join(","));
      [front, back] = [back, front];
    };
  };

  const tune = async (first = false) => {
    if (!first) { ch++; await burst(); }
    if (!saver) return;
    frame = 0;
    const c = now();
    const sys = store.systems[c.game.system];
    osdCh.textContent = `CH ${String((ch % channels.length) + 1).padStart(2, "0")}`;
    osdCh.classList.remove("blink"); void osdCh.offsetWidth; osdCh.classList.add("blink");
    caption.replaceChildren(
      c.game.box ? h("img.cap-box", { src: c.game.box, alt: "" }) : null,
      h("div", h("div.cap-t", c.game.title), h("div.cap-s", [sys?.name, c.game.year].filter(Boolean).join(" · "))));
    playBtn.lastChild.textContent = c.game.resumable ? "Resume this" : "Play this";
    showFrame(c.frames[0].src);
  };
  timers.push(setInterval(() => {
    const c = now();
    if (c.frames.length > 1) showFrame(c.frames[++frame % c.frames.length].src);
  }, FRAME_MS));
  timers.push(setInterval(() => tune(), CHANNEL_MS));

  // Input: A / Enter / Play plays this channel; anything else exits (and does nothing else).
  const play = () => { const g = now().game; stop(); playGame(g); };
  const onKey = (e) => {
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === "Enter" || e.key === " ") play(); else stop();
  };
  let moved = 0;
  const onMove = (e) => { moved += Math.abs(e.movementX) + Math.abs(e.movementY); if (moved > 40) stop(); };
  const onDown = (e) => { if (!playBtn.contains(e.target)) { e.preventDefault(); e.stopPropagation(); stop(); } };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("wheel", stop, { capture: true, passive: true });
  setCapture((k) => (k === "a" ? play() : stop()));

  function stop() {
    if (!saver) return;
    saver = null;
    timers.forEach(clearInterval);
    setCapture(null);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("wheel", stop, { capture: true });
    lastActivity = Date.now();
    el.classList.add("off");
    setTimeout(() => el.remove(), reduce ? 0 : 420);
  }
  saver = { stop };
  await tune(true);
  requestAnimationFrame(() => el.classList.add("in"));
}
