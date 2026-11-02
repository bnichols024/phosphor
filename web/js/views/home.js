import { api } from "../api.js";
import { store, go, visibleSystems } from "../store.js";
import { h, ic, consoleArt, gameCard, row, fmtTime, timeAgo, plural, imageColor, hexToRgb, setAmbient } from "../ui.js";
import { consoleIcon } from "../icons.js";
import { sound } from "../sound.js";
import { freeGamesSheet } from "../freegames.js";

export default async function home() {
  const data = await api.get("/api/home");
  const systems = store.systems;
  const open = (g) => go(`/game/${g.id}`);
  const el = h("div");
  let ambient = null;

  if (!data.stats.games) {
    el.append(welcome());
    return { el, title: "Home", ambient: ["#4b2fd6", "#0e7d74", "#3b1b6e"] };
  }

  // Hero: the game you were just playing (at the exact moment you left), else a pick for today.
  const last = data.recent[0];
  const featured = last || data.favorites[0] || data.rediscover[0] || data.added[0];
  if (featured) {
    const sys = systems[featured.system];
    const bgSrc = (last && featured.resumeThumb) || featured.snap || featured.titleArt || featured.box;
    const bg = bgSrc ? h("img", { src: bgSrc, alt: "", decoding: "async" }) : null;
    const box = featured.box ? h("img", { src: featured.box, alt: "" }) : null;
    const accent = sys?.color || "#7c5cff";
    ambient = [accent, "#0e7d74", "#1a1440"];
    if (box) box.addEventListener("load", () => { const c = imageColor(box); if (c) setAmbient([c, accent, "#140f2e"]); }, { once: true });
    el.append(h("section.hero",
      h("div.hero-bg", bg),
      h("div.hero-inner",
        h("div.hero-box", { "--ar": 0.75 }, box || coverFallback(featured, sys)),
        h("div.hero-text",
          h("div.eyebrow", last ? [h("span.pulse"), `Continue playing · ${timeAgo(last.lastPlayed)}`] : [ic("sparkles"), "Picked for you today"]),
          h("h1", featured.title),
          h("div.meta",
            h("span.chip.solid", sys?.short || featured.system),
            featured.year ? h("span.chip", String(featured.year)) : null,
            featured.genre ? h("span.chip", featured.genre) : null,
            featured.seconds ? h("span.chip", ic("clock"), `${fmtTime(featured.seconds)} played`) : null),
          h("div.hero-actions",
            h("button.btn.primary.big", { "data-nav": "", id: "hero-play", onclick: () => { sound.play("select"); window.phosphor.leaveTo(`/play/${featured.id}${last?.resumable ? "?resume=1" : ""}`); } },
              ic(last?.resumable ? "resume" : "play"), last?.resumable ? "Resume" : last ? "Play" : "Play now"),
            h("button.btn.big", { "data-nav": "", onclick: () => open(featured) }, ic("info"), "Details"))))));
  }

  // While the library is small, the most useful thing on Home is a big place to add more.
  const st = data.stats;
  if (st.games < 12) el.append(addPanel(st.games));

  // Quick stats, once there's enough to say something
  if (st.games >= 5) el.append(h("div.tiles", { style: { marginTop: featured ? "8px" : "34px" } },
    tile("This week", fmtTime(st.weekSeconds), "#7c5cff"),
    tile("Library", st.games.toLocaleString(), "#36e2c4", "games"),
    tile("Systems", String(st.systems), "#ff5c8a"),
    st.topGame ? tile("Most played", st.topGame.title, systems[st.topGame.system]?.color, null, true) : tile("All time", fmtTime(st.totalSeconds), "#f59e0b")));

  // Each game shows up once: a game you just played isn't also "recently added".
  const recent = data.recent;
  const shown = new Set(recent.map((g) => g.id));
  const added = data.added.filter((g) => !shown.has(g.id));
  el.append(...[
    row("Jump back in", recent.map((g) => gameCard(g, { systems, onOpen: open, resumable: g.resumable }))),
    row("Favorites", data.favorites.map((g) => gameCard(g, { systems, onOpen: open })), { more: { href: "/search?favorites=1", label: "All favorites" } }),
    row("Recently added", added.map((g) => gameCard(g, { systems, onOpen: open }))),
    row("Rediscover", data.rediscover.map((g) => gameCard(g, { systems, onOpen: open })), { count: "Never played" }),
  ].filter(Boolean));

  // Systems strip
  const syss = visibleSystems();
  if (syss.length) {
    el.append(h("section.row",
      h("div.row-head", h("h2", "Your consoles"), h("a.more", { href: "/library", "data-nav": "" }, "Library")),
      h("div.scroller.wide", syss.map((s) => sysCard(s)))));
  }
  return { el, title: "Home", ambient, autofocus: "#hero-play" };
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

function tile(k, v, color, unit, small = false) {
  return h("div.tile", { "--c": color || "#7c5cff" }, h("div.glow"), h("div.k", k), h("div.v", { style: small ? { fontSize: "19px", lineHeight: "1.25", marginTop: "10px" } : null }, v, unit ? h("small", unit) : null));
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
