// "Can't decide?": a reel of box art that spins, slows down with a tick per cover, and lands on
// tonight's game. Optional filters first (never played, backlog, favorites, one console).
import { api } from "./api.js";
import { store, go } from "./store.js";
import { h, ic, sheet, plural } from "./ui.js";
import { playGame } from "./actions.js";
import { sound } from "./sound.js";

const FILTERS = [["any", "Anything"], ["new", "Never played"], ["backlog", "Backlog"], ["fav", "Favorites"]];
const CARD = 150, GAP = 16;

export async function spinner() {
  const all = (await api.get("/api/games").catch(() => [])).filter((g) => !store.systems[g.system]?.locked);
  if (!all.length) return;
  let filter = "any", system = "";
  const consoles = [...new Set(all.map((g) => g.system))].sort((a, b) => (store.systems[a]?.short || a).localeCompare(store.systems[b]?.short || b));
  const pool = () => all.filter((g) => (!system || g.system === system)
    && (filter === "any" || (filter === "new" && !g.lastPlayed) || (filter === "backlog" && g.status === "backlog") || (filter === "fav" && g.favorite)));

  const strip = h("div.reel-strip");
  const reel = h("div.reel", h("div.reel-marker"), strip);
  const result = h("div.reel-result");
  const chips = h("div.chips.reel-filters");
  const countEl = h("span.reel-count");
  const spinBtn = h("button.btn.primary.big", { "data-nav": "", onclick: () => spin() }, ic("shuffle"), "Spin");
  const drawChips = () => {
    const n = pool().length;
    chips.replaceChildren(
      ...FILTERS.map(([v, label]) => h("button.chip", { "data-nav": "", class: filter === v ? "on" : "", onclick: () => { filter = v; drawChips(); } }, label)),
      h("button.chip", { "data-nav": "", class: system ? "on" : "", onclick: () => pickConsole() }, ic("gamepad"), system ? store.systems[system]?.short : "Any console"));
    countEl.textContent = n ? `${plural(n, "game")} in the draw` : "No games match: try another filter";
    spinBtn.disabled = !n;
  };
  const pickConsole = () => {
    const s2 = sheet({ title: "Which console?", body: h("div.list.pick-list",
      h("button.list-item", { "data-nav": "", onclick: () => { system = ""; s2.close(); drawChips(); } }, h("div.grow", h("div.t", "Any console"))),
      consoles.map((id) => h("button.list-item", { "data-nav": "", onclick: () => { system = id; s2.close(); drawChips(); } },
        h("div.grow", h("div.t", store.systems[id]?.name || id), h("div.d", plural(all.filter((g) => g.system === id).length, "game")))))),
    actions: [{ label: "Cancel" }] });
  };

  const tile = (g) => h("div.reel-card", { "--sys": store.systems[g.system]?.color || "#7c5cff" },
    g.box ? h("img", { src: g.box, alt: "", draggable: "false" }) : h("div.reel-noart", h("b", g.title), h("span", store.systems[g.system]?.short || "")));

  let spinning = false;
  async function spin() {
    const games = pool();
    if (spinning || !games.length) return;
    spinning = true;
    spinBtn.disabled = true;
    result.replaceChildren();
    // 40 random covers; the winner sits near the end so the reel has room to run.
    const seq = Array.from({ length: 40 }, () => games[Math.floor(Math.random() * games.length)]);
    const win = seq[34];
    strip.replaceChildren(...seq.map(tile));
    strip.style.transition = "none";
    strip.style.transform = "translateX(0)";
    const target = 34 * (CARD + GAP) - (reel.clientWidth / 2 - CARD / 2);
    const reduce = document.body.classList.contains("reduce-motion");
    const ms = reduce ? 0 : 3600;
    await new Promise((r) => requestAnimationFrame(r));
    strip.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.12, 0.72, 0.1, 1)` : "none";
    strip.style.transform = `translateX(${-target}px)`;
    // A tick for each cover that passes the marker, slowing down with the reel.
    if (ms) {
      let last = -1;
      const t0 = performance.now();
      await new Promise((done) => {
        const step = (t) => {
          const m = new DOMMatrixReadOnly(getComputedStyle(strip).transform);
          const idx = Math.floor((-m.m41 + reel.clientWidth / 2) / (CARD + GAP));
          if (idx !== last) { last = idx; sound.play("move"); }
          if (t - t0 < ms + 50) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
      });
    }
    strip.children[34]?.classList.add("win");
    sound.play("success");
    const sys = store.systems[win.system];
    result.replaceChildren(
      h("div.reel-pick", h("div.eyebrow", ic("sparkles"), "Tonight's game"), h("h2", win.title),
        h("div.meta", h("span.chip.solid", sys?.short || win.system), win.year ? h("span.chip", String(win.year)) : null, win.genre ? h("span.chip", win.genre) : null)),
      h("div.reel-actions",
        h("button.btn.primary.big#reel-play", { "data-nav": "", onclick: () => { s.close(); playGame(win); } }, ic(win.resumable ? "resume" : "play"), win.resumable ? "Resume" : "Play"),
        h("button.btn.big", { "data-nav": "", onclick: () => { s.close(); go(`/game/${win.id}`); } }, ic("info"), "Details"),
        h("button.btn.big", { "data-nav": "", onclick: () => spin() }, ic("shuffle"), "Spin again")));
    result.querySelector("#reel-play")?.focus({ preventScroll: true });
    spinning = false;
    spinBtn.disabled = false;
  }

  const s = sheet({
    title: "Can't decide?", sub: "Pick what's in the draw, then spin.", wide: true,
    body: h("div.spinner", chips, h("div.reel-bar", countEl, spinBtn), reel, result),
  });
  drawChips();
  // Fill the reel with a few covers so it doesn't start empty.
  strip.replaceChildren(...all.slice(0, 12).map(tile));
  setTimeout(() => spinBtn.focus({ preventScroll: true }), 60);
}
