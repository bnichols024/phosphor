import { api } from "../api.js";
import { store, go, visibleSystems } from "../store.js";
import { h, ic, consoleArt, gameCard, row, fmtTime, timeAgo, plural, imageColor, setAmbient } from "../ui.js";
import { consoleIcon, LOGO } from "../icons.js";
import { STATUS, playGame, cardMenu } from "../actions.js";
import { spinner } from "../spinner.js";
import { sound } from "../sound.js";
import { freeGamesSheet } from "../freegames.js";

export default async function home() {
  const data = await api.get("/api/home");
  const systems = store.systems;
  const open = (g) => go(`/game/${g.id}`);
  const el = h("div");

  if (!data.stats.games) {
    el.append(welcome());
    return { el, title: "Home", ambient: ["#4b2fd6", "#0e7d74", "#3b1b6e"] };
  }
  const st = data.stats;
  el.append(brandHeader(st));

  // Hero: what you were playing, a pick for today, a favorite you haven't touched in a while.
  const last = data.recent[0];
  const slides = [];
  const seen = new Set();
  const add = (g, kind) => { if (g && !seen.has(g.id)) { seen.add(g.id); slides.push({ g, kind }); } };
  add(last, "continue");
  add(data.todaysPick, "pick");
  add(data.forgotten, "forgotten");
  if (!slides.length) add(data.favorites[0] || data.rediscover[0] || data.added[0], "pick");
  let hero = null;
  if (slides.length) { hero = heroCarousel(slides); el.append(hero.el); }

  // While the library is small, the most useful thing on Home is a big place to add more.
  if (st.games < 12) el.append(addPanel(st.games));

  // Pick up where you left off: the save-state picture of exactly where you stopped.
  const withState = data.recent.filter((g) => g.resumeThumb).slice(0, 8);
  if (withState.length) {
    el.append(h("section.row",
      h("div.row-head", h("h2", "Pick up where you left off")),
      h("div.scroller.wide", withState.map(resumeCard))));
  }
  const shown = new Set(withState.map((g) => g.id));
  const recent = data.recent.filter((g) => !shown.has(g.id));
  recent.forEach((g) => shown.add(g.id));
  const added = data.added.filter((g) => !shown.has(g.id));
  el.append(...[
    row("Jump back in", recent.map((g) => gameCard(g, { systems, onOpen: open, resumable: g.resumable }))),
    st.games >= 3 ? spinnerCard() : null,
    row("Favorites", data.favorites.map((g) => gameCard(g, { systems, onOpen: open })), { more: { href: "/library?view=games&show=fav", label: "All favorites" } }),
    row("Recently added", added.map((g) => gameCard(g, { systems, onOpen: open }))),
    row("Rediscover", data.rediscover.map((g) => gameCard(g, { systems, onOpen: open })), { count: "Never played" }),
  ].filter(Boolean));

  // Systems strip
  const syss = visibleSystems();
  if (syss.length) {
    el.append(h("section.row",
      h("div.row-head", h("h2", "Your consoles"), h("a.more", { href: "/library?view=consoles", "data-nav": "" }, "Library")),
      h("div.scroller.wide", syss.map((s) => sysCard(s)))));
  }
  return { el, title: "Home", ambient: hero?.ambient || null, autofocus: "#hero-play", destroy: () => hero?.destroy() };
}

// ---------- branded header ----------
function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? "Up late" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
}
function brandHeader(st) {
  const p = store.profile || {};
  const bits = [
    st.streak ? `${st.streak}-day streak` : null,
    st.weekSeconds ? `${fmtTime(st.weekSeconds)} this week` : "Nothing played this week yet",
    `${plural(st.games, "game")} on ${plural(st.systems, "console")}`,
  ].filter(Boolean);
  const s = st.status || {};
  const statusLinks = [["playing", "playing"], ["backlog", "in backlog"], ["beaten", "beaten"]]
    .filter(([k]) => s[k]).map(([k, label]) => h("a.brand-st", { href: `/library?view=games&show=${k === "playing" ? "progress" : k}`, "data-nav": "", "--st": STATUS[k].color }, ic(STATUS[k].icon), `${s[k]} ${label}`));
  return h("header.brand",
    h("div.brand-mark", h("span.brand-logo", { html: LOGO }), h("span.wordmark", "Phosphor")),
    h("div.brand-hello",
      h("div.hello", `${greeting()}, ${p.name || "player"}`, p.avatar ? h("span.hello-av", { "--c": p.color || "#7c5cff" }, p.avatar) : null),
      h("div.hello-stats", bits.join("  ·  ")),
      statusLinks.length ? h("div.brand-status", statusLinks) : null));
}

// ---------- hero carousel ----------
const EYEBROW = {
  continue: (g) => [h("span.pulse"), `Continue playing · ${timeAgo(g.lastPlayed)}`],
  pick: () => [ic("sparkles"), "Today's pick"],
  forgotten: (g) => [ic("heartFill"), g.lastPlayed ? `A favorite you last played ${timeAgo(g.lastPlayed)}` : "A favorite you haven't played yet"],
};
function heroCarousel(slides) {
  const systems = store.systems;
  const reduce = document.body.classList.contains("reduce-motion");
  let i = 0, timer = null, paused = false;
  const make = ({ g, kind }, idx) => {
    const sys = systems[g.system];
    const bgSrc = (kind === "continue" && g.resumeThumb) || g.snap || g.titleArt || g.box;
    const box = g.box ? h("img", { src: g.box, alt: "" }) : null;
    const resume = kind === "continue" && g.resumable;
    return h("section.hero", { class: idx === 0 ? "on" : "", "data-kind": kind, "--sys": sys?.color || "#7c5cff" },
      h("div.hero-bg", bgSrc ? h("img", { src: bgSrc, alt: "", decoding: "async" }) : null),
      h("div.hero-inner",
        h("div.hero-box", { "--ar": 0.75 }, box || coverFallback(g, sys)),
        h("div.hero-text",
          h("div.eyebrow", EYEBROW[kind](g)),
          h("h1", g.title),
          h("div.meta",
            h("span.chip.solid", sys?.short || g.system),
            g.year ? h("span.chip", String(g.year)) : null,
            g.genre ? h("span.chip", g.genre) : null,
            g.seconds ? h("span.chip", ic("clock"), `${fmtTime(g.seconds)} played`) : null),
          h("div.hero-actions",
            h("button.btn.primary.big", { "data-nav": "", id: idx === 0 ? "hero-play" : null, onclick: () => playGame({ ...g, resumable: resume }) },
              ic(resume ? "resume" : "play"), resume ? "Resume" : kind === "continue" ? "Play" : "Play now"),
            h("button.btn.big", { "data-nav": "", onclick: () => go(`/game/${g.id}`) }, ic("info"), "Details")))));
  };
  const els = slides.map(make);
  const dots = slides.length > 1 ? h("div.hero-dots", slides.map((x, idx) => h("button.hero-dot", { "data-nav": "", class: idx === 0 ? "on" : "", "aria-label": `Show ${x.g.title}`, onclick: () => { show(idx); restart(); } }))) : null;
  const wrap = h("div.hero-carousel", els, dots);
  const ambientFor = (idx) => { const c = systems[slides[idx].g.system]?.color || "#7c5cff"; return [c, "#0e7d74", "#1a1440"]; };
  const show = (n) => {
    i = (n + slides.length) % slides.length;
    els.forEach((e, k) => { e.classList.toggle("on", k === i); e.inert = k !== i; });
    dots?.querySelectorAll(".hero-dot").forEach((d, k) => d.classList.toggle("on", k === i));
    const img = els[i].querySelector(".hero-box img");
    const c = img?.complete ? imageColor(img) : null;
    setAmbient(c ? [c, ambientFor(i)[0], "#140f2e"] : ambientFor(i));
  };
  els.forEach((e, k) => { e.inert = k !== 0; });
  const restart = () => { clearInterval(timer); if (!reduce && slides.length > 1) timer = setInterval(() => { if (!paused && !document.hidden) show(i + 1); }, 9000); };
  wrap.addEventListener("pointerenter", () => { paused = true; });
  wrap.addEventListener("pointerleave", () => { paused = false; });
  wrap.addEventListener("focusin", () => { paused = true; });
  wrap.addEventListener("focusout", () => { paused = false; });
  const firstBox = els[0].querySelector(".hero-box img");
  firstBox?.addEventListener("load", () => { const c = imageColor(firstBox); if (c && i === 0) setAmbient([c, ambientFor(0)[0], "#140f2e"]); }, { once: true });
  restart();
  return { el: wrap, ambient: ambientFor(0), destroy: () => clearInterval(timer) };
}

// ---------- pick up where you left off ----------
function resumeCard(g) {
  const sys = store.systems[g.system];
  const c = h("button.resume-card", { "data-nav": "", "--sys": sys?.color || "#7c5cff", onclick: () => playGame({ ...g, resumable: true }),
    oncontextmenu: (e) => { e.preventDefault(); cardMenu(g, e.clientX, e.clientY); } },
    h("div.rc-shot", h("img", { src: g.resumeThumb, alt: "", loading: "lazy" }), h("span.rc-play", ic("resume"))),
    h("div.rc-meta",
      g.box ? h("img.rc-box", { src: g.box, alt: "", loading: "lazy" }) : null,
      h("div.rc-text", h("b", g.title), h("span", `${sys?.short || ""} · Saved ${timeAgo(g.resumedAt || g.lastPlayed)}`))));
  c.game = { ...g, resumable: true };
  return c;
}

// ---------- can't decide? ----------
function spinnerCard() {
  return h("section.spin-card", { "data-nav": "", tabindex: "0", onclick: () => spinner(), onkeydown: (e) => { if (e.key === "Enter") spinner(); } },
    h("div.spin-reels", ...["#7c5cff", "#36e2c4", "#ff5c8a"].map((c) => h("span", { "--c": c }, ic("shuffle")))),
    h("div.grow", h("h2", "Can't decide?"), h("p", "Spin through your library and let Phosphor pick tonight's game.")),
    h("span.btn.primary", ic("shuffle"), "Spin"));
}

// Drag target + the drop folder's real location, so adding games never needs explaining.
function addPanel(count) {
  const lib = store.state.library;
  const panel = h("section.add-panel", { "data-nav": "", tabindex: "0", onclick: (e) => { if (!e.target.closest("button")) window.phosphor.addGamesSheet(); } },
    h("div.add-icon", ic("plus")),
    h("div.grow",
      h("h2", count ? "Add more games" : "Add your games"),
      h("p", "Drag games onto this window: any console, zipped or not, single files or whole folders. Or copy them into your drop folder:"),
      h("code.add-path", lib.dropFolder)),
    h("div.add-buttons",
      h("button.btn.primary", { "data-nav": "", onclick: () => window.phosphor.pickFiles() }, ic("upload"), "Choose files…"),
      window.phosphorDesktop ? h("button.btn", { "data-nav": "", onclick: () => window.phosphorDesktop.openFolder("Drop Games Here") }, ic("folder"), "Open drop folder") : null,
      h("button.btn", { "data-nav": "", onclick: () => freeGamesSheet() }, ic("gift"), "Free games")));
  panel.addEventListener("dragover", () => panel.classList.add("over"));
  panel.addEventListener("dragleave", () => panel.classList.remove("over"));
  panel.addEventListener("drop", () => panel.classList.remove("over"));
  return panel;
}

function coverFallback(g, sys) {
  return h("div.cover-gen", { "--sys": sys?.color || "#7c5cff" }, consoleArt(sys), h("div.t", g.title), h("div.s", sys?.short || ""));
}

export function sysCard(s) {
  return h("a.syscard", { href: `/system/${s.id}`, "data-nav": "", "--sys": s.color, class: [s.count ? "" : "empty", s.photo ? "has-photo" : ""].filter(Boolean).join(" ") },
    h("div.glowspot"),
    consoleArt(s),
    s.locked ? h("span.chip.lock", ic("lock"), s.needs?.chip || "Needs BIOS") : null,
    h("div.maker", s.maker),
    h("div.name", s.short === s.name || s.short.length > 14 ? s.name : s.short),
    h("div.count", s.count ? plural(s.count, "game") : "No games yet", s.status === "experimental" ? h("span.chip", "Beta") : null));
}

function welcome() {
  const root = store.state.library;
  const fan = ["snes", "genesis", "psx", "n64"].map((id) => store.systems[id]).filter((s) => s?.photo);
  const orbit = fan.length ? h("div.orbit.fan", fan.map((s, i) => consoleArt(s, `ico f${i}`))) : h("div.orbit", { html: consoleIcon("pad-snes") });
  return h("section.welcome",
    orbit,
    h("div.eyebrow", { style: { marginBottom: "16px" } }, "Welcome to Phosphor"),
    h("h1", "Let's fill your shelf."),
    h("p", `${visibleSystems({ includeEmpty: true }).filter((s) => !s.locked && (!s.native || store.state.desktop)).length} consoles are ready to play, with every emulator built in and nothing to set up. Add your games and Phosphor sorts them, finds the box art, and remembers where you left off on every device.`),
    h("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap" } },
      h("button.btn.primary.big", { "data-nav": "", onclick: () => window.phosphor.pickFiles() }, ic("upload"), "Add games"),
      h("button.btn.big", { "data-nav": "", onclick: () => freeGamesSheet() }, ic("gift"), "Get free games"),
      window.phosphorDesktop ? h("button.btn.big", { "data-nav": "", onclick: () => window.phosphorDesktop.openFolder("Drop Games Here") }, ic("folder"), "Open drop folder") : null,
      h("a.btn.big", { href: "/library", "data-nav": "" }, ic("library"), "See all consoles")),
    h("div.steps",
      h("div.step", h("b", h("i", "1"), "Drop them anywhere"), h("p", "Drag game files or whole folders onto this window. Zipped is fine.")),
      h("div.step", h("b", h("i", "2"), window.phosphorDesktop ? "Or copy them into the folder" : "Or copy to the server"), h("p", "Put files in ", h("code", root.dropFolder), " and they're picked up automatically.")),
      h("div.step", h("b", h("i", "3"), "Play anywhere"), h("p", "TV, laptop or phone. Your saves follow you, and your phone can be the controller."))));
}
