// The game browser: search, filters, sort, grid or list, A–Z jump and a random pick over a list
// of games. A console's page uses it for that console; Library › Games for every game.
// Every picker is a button that opens a sheet of choices, so it all works with a controller.
import { store, go } from "./store.js";
import { h, ic, gameCard, plural, sheet, toast, fmtTime, timeAgo } from "./ui.js";
import { STATUS, onGameChange } from "./actions.js";
import { sound } from "./sound.js";
import { getProfile } from "./api.js";

export const SORTS = [["az", "A–Z"], ["recent", "Recently played"], ["played", "Most played"], ["added", "Newest"], ["year", "Release year"], ["system", "Console"]];
// Status chips: what a player most often wants to narrow to.
const SHOW = [["all", "All"], ["fav", "Favorites"], ["progress", "In progress"], ["new", "Never played"], ["backlog", "Backlog"], ["beaten", "Beaten"]];
const PLAYERS = [["", "Any number"], ["1", "1 player"], ["2", "2+ players"], ["4", "4+ players"]];
const DEFAULTS = { q: "", sort: "az", show: "all", systems: [], genre: "", decade: "", players: "", region: "", layout: "grid" };
const PAGE = 120;

// Collapse region variants of one game to the player's preferred region.
export function groupVariants(games, order) {
  const best = new Map();
  const rank = (g) => { const i = order.indexOf(g.region); return i === -1 ? 50 : i; };
  for (const g of games) {
    const k = `${g.system}|${g.title.toLowerCase()}`;
    const cur = best.get(k);
    if (!cur) best.set(k, { ...g, variants: 1 });
    else {
      const keep = (g.favorite && !cur.favorite) || (g.lastPlayed || 0) > (cur.lastPlayed || 0) || (rank(g) < rank(cur) && !cur.lastPlayed) ? { ...g, variants: cur.variants + 1 } : { ...cur, variants: cur.variants + 1 };
      best.set(k, keep);
    }
  }
  return [...best.values()];
}

const decadeOf = (y) => (y ? `${Math.floor(y / 10) * 10}s` : "");
const letterOf = (t) => { const c = (t || "").replace(/^(the|a)\s+/i, "").charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : "#"; };
const cmpTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });

// key: where this browser remembers its filters (per player), e.g. "games" or "system:snes".
// fixedSystem: a console's own page (no console filter). query: the page's URL query.
export function gameBrowser({ games, key, fixedSystem = null, ratio = 0.75, query = {} }) {
  const storeKey = `phosphor.browse.${key}.${getProfile() || 0}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storeKey) || "{}"); } catch { /* fresh */ }
  const st = { ...DEFAULTS, ...saved };
  // The URL wins over what was remembered (links like "Backlog" from Home).
  for (const k of Object.keys(DEFAULTS)) if (query[k] != null) st[k] = k === "systems" ? String(query[k]).split(",").filter(Boolean) : query[k];
  const persist = () => {
    localStorage.setItem(storeKey, JSON.stringify(st));
    const u = new URL(location.href);
    for (const [k, v] of Object.entries(st)) {
      const val = Array.isArray(v) ? v.join(",") : v;
      if (val && val !== DEFAULTS[k]) u.searchParams.set(k, val); else u.searchParams.delete(k);
    }
    history.replaceState(history.state, "", u.pathname + u.search);
  };

  const sysName = (id) => store.systems[id]?.short || id;
  const genres = [...new Set(games.map((g) => g.genre).filter(Boolean))].sort();
  const decades = [...new Set(games.map((g) => decadeOf(g.year)).filter(Boolean))].sort();
  const regions = [...new Set(games.map((g) => g.region).filter(Boolean))].sort();
  const systemsIn = [...new Set(games.map((g) => g.system))].sort((a, b) => sysName(a).localeCompare(sysName(b)));

  const grid = h("div.grid");
  const listEl = h("div.glist");
  const sentinel = h("div", { style: { height: "1px" } });
  const empty = h("div.empty-state", { hidden: true }, h("h2", "Nothing matches"), h("p", "Try a different search or filter."),
    h("button.btn", { "data-nav": "", onclick: () => { Object.assign(st, { ...DEFAULTS, layout: st.layout, sort: st.sort }); refresh(); } }, ic("x"), "Clear filters"));
  const count = h("span.browse-count");
  const letters = h("div.az");
  let list = [];
  let shown = 0;

  const card = (g) => gameCard(g, { systems: store.systems, ratio, showSystem: !fixedSystem, onOpen: (x) => go(`/game/${x.id}`) });
  const rowEl = (g) => {
    const sys = store.systems[g.system];
    const s = g.status && STATUS[g.status];
    const el = h("button.grow-row", { "data-nav": "", "data-game-id": g.id, onclick: () => { sound.play("select"); go(`/game/${g.id}`); } },
      h("span.gr-art", g.box ? h("img", { src: g.box, alt: "", loading: "lazy" }) : h("span.gr-noart", { "--sys": sys?.color || "#475569" }, (sys?.short || "?").slice(0, 3))),
      h("span.gr-title", h("b", g.title), g.favorite ? h("span.fav", ic("heartFill")) : null),
      fixedSystem ? null : h("span.gr-sys", { "--sys": sys?.color || "#475569" }, sys?.short || g.system),
      h("span.gr-year", g.year ? String(g.year) : ""),
      h("span.gr-genre", g.genre || ""),
      h("span.gr-players", g.players ? (g.players === 1 ? "1P" : `1–${g.players}P`) : ""),
      h("span.gr-time", g.seconds ? fmtTime(g.seconds) : ""),
      h("span.gr-last", g.lastPlayed ? timeAgo(g.lastPlayed) : "Never"),
      h("span.gr-status", s ? h("span.st-pill", { "--st": s.color }, ic(s.icon), s.label) : ""));
    el.game = g;
    return el;
  };
  const more = () => {
    const next = list.slice(shown, shown + PAGE);
    if (st.layout === "list") listEl.append(...next.map(rowEl)); else grid.append(...next.map(card));
    shown += next.length;
  };
  const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && shown < list.length) more(); }, { rootMargin: "1200px" });

  const apply = () => {
    let out = games;
    if (st.q) { const w = st.q.toLowerCase().split(/\s+/).filter(Boolean); out = out.filter((g) => w.every((x) => `${g.title} ${g.genre || ""} ${sysName(g.system)} ${g.year || ""}`.toLowerCase().includes(x))); }
    if (st.show === "fav") out = out.filter((g) => g.favorite);
    if (st.show === "progress") out = out.filter((g) => g.resumable || g.status === "playing");
    if (st.show === "new") out = out.filter((g) => !g.lastPlayed);
    if (st.show === "backlog" || st.show === "beaten" || st.show === "playing" || st.show === "dropped") out = out.filter((g) => g.status === st.show);
    if (st.systems.length) { const set = new Set(st.systems); out = out.filter((g) => set.has(g.system)); }
    if (st.genre) out = out.filter((g) => g.genre === st.genre);
    if (st.decade) out = out.filter((g) => decadeOf(g.year) === st.decade);
    if (st.players) out = out.filter((g) => (g.players || 1) >= Number(st.players) && (st.players !== "1" || (g.players || 1) === 1));
    if (st.region) out = out.filter((g) => g.region === st.region);
    if (store.settings.groupRegions) out = groupVariants(out, store.settings.regionOrder || ["US", "World", "EU", "JP"]);
    const by = {
      az: cmpTitle,
      recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || cmpTitle(a, b),
      played: (a, b) => b.seconds - a.seconds || cmpTitle(a, b),
      added: (a, b) => b.addedAt - a.addedAt || cmpTitle(a, b),
      year: (a, b) => (a.year || 9999) - (b.year || 9999) || cmpTitle(a, b),
      system: (a, b) => sysName(a.system).localeCompare(sysName(b.system)) || cmpTitle(a, b),
    }[st.sort] || cmpTitle;
    list = [...out].sort(by);
    grid.replaceChildren(); listEl.replaceChildren();
    grid.hidden = st.layout === "list"; listEl.hidden = st.layout !== "list";
    listHead.hidden = st.layout !== "list";
    shown = 0;
    more();
    const total = games.length;
    count.textContent = list.length === total ? plural(total, "game") : `${list.length.toLocaleString()} of ${plural(total, "game")}`;
    empty.hidden = list.length > 0 || !games.length;
    drawLetters();
  };

  // A–Z jump (when sorted by title): render up to that letter, then focus its first game.
  const drawLetters = () => {
    letters.hidden = st.sort !== "az" || list.length < 40;
    if (letters.hidden) return letters.replaceChildren();
    const first = new Map();
    list.forEach((g, i) => { const l = letterOf(g.title); if (!first.has(l)) first.set(l, i); });
    letters.replaceChildren(...["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((l) => h("button.az-l", {
      "data-nav": "", disabled: !first.has(l),
      onclick: () => {
        const i = first.get(l);
        while (shown <= i && shown < list.length) more();
        const target = (st.layout === "list" ? listEl : grid).children[i];
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
      },
    }, l)));
  };

  // A sheet of choices. multi: tick several, then Done.
  const pick = (title, options, current, { multi = false } = {}) => new Promise((resolve) => {
    const chosen = new Set(multi ? current : [current]);
    const items = options.map(([value, label, extra]) => {
      const el = h("button.list-item", { "data-nav": "", class: chosen.has(value) ? "on" : "", onclick: () => {
        if (!multi) { s.close(); return resolve(value); }
        chosen.has(value) ? chosen.delete(value) : chosen.add(value);
        el.classList.toggle("on", chosen.has(value));
        el.querySelector(".mark").replaceChildren(chosen.has(value) ? ic("check") : "");
      } }, h("div.grow", h("div.t", label), extra ? h("div.d", extra) : null), h("span.mark", chosen.has(value) ? ic("check") : ""));
      return el;
    });
    const s = sheet({
      title, body: h("div.list.pick-list", items),
      actions: multi ? [{ label: "Clear", onClick: () => { s.close(); resolve([]); return false; } }, { label: "Done", kind: "primary", onClick: () => { resolve([...chosen]); } }] : [{ label: "Cancel" }],
      onClose: () => resolve(multi ? [...chosen] : current),
    });
  });

  const pickerBtn = (label, valueText, onClick) => h("button.chip.picker", { "data-nav": "", class: valueText ? "on" : "", onclick: onClick },
    h("span", valueText ? `${label}: ${valueText}` : label), ic("more"));
  const counted = (key) => (v) => games.filter((g) => key(g) === v).length;
  const toolbarRow = h("div.browse-pickers");
  const showRow = h("div.chips.browse-show");
  const viewBtns = h("div.segmented.view-switch");
  const clearBtn = h("button.chip", { "data-nav": "", onclick: () => { Object.assign(st, { ...DEFAULTS, layout: st.layout, sort: st.sort }); searchInput.value = ""; refresh(); } }, ic("x"), "Clear");
  const filtersActive = () => st.q || st.show !== "all" || st.systems.length || st.genre || st.decade || st.players || st.region;

  const drawControls = () => {
    const sysCount = counted((g) => g.system);
    toolbarRow.replaceChildren(...[
      fixedSystem ? null : pickerBtn("Console", st.systems.length ? (st.systems.length === 1 ? sysName(st.systems[0]) : `${st.systems.length} consoles`) : "", async () => {
        st.systems = await pick("Consoles", systemsIn.map((id) => [id, store.systems[id]?.name || id, plural(sysCount(id), "game")]), st.systems, { multi: true }); refresh();
      }),
      genres.length > 1 ? pickerBtn("Genre", st.genre, async () => { st.genre = await pick("Genre", [["", "All genres"], ...genres.map((g) => [g, g, plural(counted((x) => x.genre)(g), "game")])], st.genre); refresh(); }) : null,
      decades.length > 1 ? pickerBtn("Decade", st.decade, async () => { st.decade = await pick("Decade", [["", "Any year"], ...decades.map((d) => [d, `The ${d}`, plural(counted((x) => decadeOf(x.year))(d), "game")])], st.decade); refresh(); }) : null,
      pickerBtn("Players", PLAYERS.find(([v]) => v === st.players && v)?.[1] || "", async () => { st.players = await pick("Players", PLAYERS, st.players); refresh(); }),
      regions.length > 1 ? pickerBtn("Region", st.region, async () => { st.region = await pick("Region", [["", "Any region"], ...regions.map((r) => [r, r])], st.region); refresh(); }) : null,
      h("button.chip.picker", { "data-nav": "", onclick: async () => { st.sort = await pick("Sort by", SORTS, st.sort); refresh(); } }, ic("sliders"), h("span", SORTS.find(([v]) => v === st.sort)?.[1] || "A–Z")),
      filtersActive() ? clearBtn : null].filter(Boolean));
    showRow.replaceChildren(...SHOW.map(([v, label]) => h("button.chip", { "data-nav": "", class: st.show === v ? "on" : "", onclick: () => { st.show = st.show === v ? "all" : v; refresh(); } }, label)));
    viewBtns.replaceChildren(
      h("button", { "data-nav": "", class: st.layout === "grid" ? "on" : "", "aria-label": "Grid", onclick: () => { st.layout = "grid"; refresh(); } }, ic("library")),
      h("button", { "data-nav": "", class: st.layout === "list" ? "on" : "", "aria-label": "List", onclick: () => { st.layout = "list"; refresh(); } }, ic("menu")));
  };
  const refresh = () => { persist(); drawControls(); apply(); };

  let typing = null;
  const searchInput = h("input", { type: "search", placeholder: fixedSystem ? `Search ${sysName(fixedSystem)} games` : "Search every game", value: st.q, "aria-label": "Search",
    oninput: (e) => { clearTimeout(typing); typing = setTimeout(() => { st.q = e.target.value.trim(); persist(); drawControls(); apply(); }, 120); } });
  const randomBtn = h("button.btn.small.ghost", { "data-nav": "", onclick: () => {
    const pool = list.length ? list : games;
    const g = pool[Math.floor(Math.random() * pool.length)];
    if (!g) return;
    toast({ title: `How about ${g.title}?`, icon: "shuffle", img: g.box });
    go(`/game/${g.id}`);
  } }, ic("shuffle"), "Random");

  const listHead = h("div.glist-head", { hidden: true },
    h("span"), h("span", "Title"), fixedSystem ? null : h("span", "Console"), h("span", "Year"), h("span", "Genre"), h("span", "Players"), h("span", "Played"), h("span", "Last played"), h("span", "Status"));
  if (fixedSystem) listEl.classList.add("no-sys"), listHead.classList.add("no-sys");

  const toolbar = h("div.toolbar.browse",
    h("div.browse-top", h("label.field.search", ic("search"), searchInput), toolbarRow, h("div.browse-right", count, viewBtns, randomBtn)),
    h("div.browse-bottom", showRow, letters));
  const body = h("div.page", { style: { paddingTop: "10px" } }, listHead, grid, listEl, empty, sentinel);

  // Changes made from a card's menu or the game page show up here too.
  const off = onGameChange((id, patch) => {
    const g = games.find((x) => x.id === id);
    if (g) Object.assign(g, patch);
    if (("status" in patch && ["backlog", "beaten", "progress"].includes(st.show)) || ("favorite" in patch && st.show === "fav")) apply();
  });

  drawControls();
  apply();
  io.observe(sentinel);
  return { toolbar, body, destroy: () => { io.disconnect(); off(); } };
}
