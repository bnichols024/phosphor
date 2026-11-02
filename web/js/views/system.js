import { api } from "../api.js";
import { store, go, refreshState } from "../store.js";
import { h, ic, consoleArt, gameCard, plural, emptyState, hexToRgb, toast, toastError, confirmBox, desktopLink } from "../ui.js";
import { sound } from "../sound.js";
import { folderSheet } from "./library.js";

const SORTS = [["az", "A–Z"], ["recent", "Recently played"], ["played", "Most played"], ["added", "Newest"], ["year", "Release year"]];

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

// This console's emulator: version, a check for a newer one, and Update / Previous version for
// just this emulator (the same as its row in Settings › Emulators).
function emulatorBar(sys) {
  if (sys.native && !store.state.desktop) return null;
  const item = sys.native ? { kind: "native", id: sys.native } : { kind: "core", id: sys.core };
  const summary = store.state.emulators || {};
  const name = sys.native ? sys.nativeName : summary.coreNames?.[sys.core] || sys.core;
  const version = () => {
    const sm = store.state.emulators || {};
    return sys.native ? sm.native?.find((n) => n.id === sys.native)?.version : sm.active?.cores?.[sys.core];
  };
  const status = h("span.emu-status");
  const actions = h("span.emu-actions");
  const label = h("span.emu-name");
  const bar = h("div.emu-bar", ic("cpu"), label, status, actions);
  let info = null;
  const busy = (text) => { status.className = "emu-status busy"; status.replaceChildren(h("i.spin"), text); actions.replaceChildren(); };
  const draw = () => {
    const v = version();
    label.replaceChildren(h("b", name), v ? ` v${v}` : " · not installed");
    actions.replaceChildren();
    if (!info) return;
    if (info.error) { status.className = "emu-status"; status.textContent = "Couldn't check for updates"; }
    else if (info.changed) {
      status.className = "emu-status new"; status.textContent = `v${info.to} available`;
      actions.append(h("button.btn.small.primary", { "data-nav": "", onclick: update }, ic("download"), v ? "Update" : "Install"));
    } else { status.className = "emu-status ok"; status.replaceChildren(ic("check"), "Up to date"); }
    if (info.previous && info.previous !== info.to) {
      actions.append(h("button.btn.small.ghost", { "data-nav": "", onclick: rollback }, ic("history"), `Previous version (v${info.previous})`));
    }
  };
  const check = async () => {
    busy("Checking for updates…");
    try { info = await api.post("/api/emulators/check-one", item); } catch (e) { info = { error: e.message }; }
    draw();
  };
  const onProgress = async (e) => {
    if (!bar.isConnected) { window.removeEventListener("phosphor:emulators", onProgress); return; }
    const st = e.detail;
    if (st.running) busy(st.message || "Updating…");
    else if (st.phase === "done" || st.phase === "failed") {
      await refreshState().catch(() => {});
      if (st.phase === "failed") { status.className = "emu-status"; status.textContent = st.error || "Update failed"; }
      await check();
    }
  };
  window.addEventListener("phosphor:emulators", onProgress);
  async function update() {
    sound.play("select");
    busy(`Updating ${name}…`);
    try { await api.post("/api/emulators/update", item); } catch (e) { toastError(e); draw(); }
  }
  async function rollback() {
    if (!(await confirmBox(`Go back to ${name} ${info.previous}?`, `Only ${name} changes. You can update it again any time.`, { ok: "Go back" }))) return;
    busy("Going back…");
    try {
      await api.post("/api/emulators/rollback", item);
      await refreshState().catch(() => {});
      toast({ title: `Back on ${name} ${info.previous}`, icon: "history", kind: "good" });
    } catch (e) { toastError(e); }
    await check();
  }
  draw();
  check();
  return bar;
}

export default async function systemView({ params, query }) {
  const sys = store.systems[params.id];
  if (!sys) throw new Error("Unknown console.");
  const games = await api.get(`/api/games?system=${sys.id}`);
  const st = { q: query.q || "", sort: query.sort || "az", filter: "all", genre: "" };
  const icon = consoleArt(sys);
  const genres = [...new Set(games.map((g) => g.genre).filter(Boolean))].sort();

  const grid = h("div.grid");
  const count = h("span", "No games yet");
  const sentinel = h("div", { style: { height: "1px" } });
  let list = [];
  let shown = 0;
  const PAGE = 120;
  const more = () => {
    const next = list.slice(shown, shown + PAGE);
    grid.append(...next.map((g) => gameCard(g, { systems: store.systems, ratio: sys.box, showSystem: false, onOpen: (x) => go(`/game/${x.id}`) })));
    shown += next.length;
  };
  const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && shown < list.length) more(); }, { rootMargin: "1200px" });

  const apply = () => {
    let out = games;
    if (st.q) { const w = st.q.toLowerCase().split(/\s+/); out = out.filter((g) => w.every((x) => g.title.toLowerCase().includes(x))); }
    if (st.filter === "fav") out = out.filter((g) => g.favorite);
    if (st.filter === "played") out = out.filter((g) => g.lastPlayed);
    if (st.filter === "multi") out = out.filter((g) => (g.players || 1) >= 2);
    if (st.filter === "new") out = out.filter((g) => !g.lastPlayed);
    if (st.genre) out = out.filter((g) => g.genre === st.genre);
    if (store.settings.groupRegions) out = groupVariants(out, store.settings.regionOrder || ["US", "World", "EU", "JP"]);
    const by = {
      az: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }),
      recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.title.localeCompare(b.title),
      played: (a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title),
      added: (a, b) => b.addedAt - a.addedAt,
      year: (a, b) => (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title),
    }[st.sort];
    list = [...out].sort(by);
    grid.replaceChildren();
    shown = 0;
    more();
    count.textContent = list.length === games.length ? plural(games.length, "game") : `${list.length.toLocaleString()} of ${plural(games.length, "game")}`;
    empty.hidden = list.length > 0 || !games.length;
  };

  const chip = (id, label) => h("button.chip", { "data-nav": "", class: st.filter === id ? "on" : "", onclick: (e) => {
    st.filter = st.filter === id && id !== "all" ? "all" : id;
    e.currentTarget.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.f === st.filter));
    apply();
  }, dataset: { f: id } }, label);

  const empty = h("div.empty-state", { hidden: true }, h("h2", "Nothing matches"), h("p", "Try a different search or filter."));
  const searchInput = h("input", { type: "search", placeholder: `Search ${sys.short} games`, value: st.q, oninput: (e) => { st.q = e.target.value; apply(); }, "aria-label": "Search" });

  const el = h("div", { "--sys": sys.color },
    h("section.sys-hero",
      icon,
      h("div.eyebrow", `${sys.maker} · ${sys.year}`),
      h("h1", sys.name),
      h("div.facts",
        h("span.chip.solid", count),
        sys.native && !store.state.desktop ? h("span.chip", ic("cpu"), "Desktop app") : null,
        sys.needs ? h("span.chip", ic(sys.locked ? "lock" : "check"), sys.locked ? sys.needs.chip : "Your files are ready")
          : sys.bios === "yours" ? null : h("span.chip", { title: sys.biosLabel || "" }, ic("check"), { included: "BIOS included", builtin: "BIOS built in", none: "No BIOS needed" }[sys.bios]),
        sys.status === "experimental" ? h("span.chip", { style: { color: "var(--warn)" } }, ic("alert"), "Beta") : null,
        h("span.chip", ic("folder"), `ROMs/${sys.folder}`)),
      emulatorBar(sys),
      sys.native && !store.state.desktop ? h("div.note.info", { style: { marginTop: "16px", maxWidth: "720px" } }, ic("info"),
        h("div", `${sys.short} games play in the free Phosphor desktop app for Windows, Mac and Linux, which runs ${sys.nativeName} on your computer. You can still add and browse them here.`,
          h("div", { style: { marginTop: "10px" } }, desktopLink()))) : null,
      sys.note ? h("div.note.info", { style: { marginTop: "16px", maxWidth: "720px" } }, ic("info"), h("div", sys.note)) : null,
      sys.threads && !window.isSecureContext ? h("div.note", { style: { marginTop: "12px", maxWidth: "720px" } }, ic("lock"),
        h("div", `${sys.short} games need a secure connection: open Phosphor with https:// (or http://localhost on the server itself). Every other console works over plain http.`)) : null,
      sys.locked && sys.needs ? h("div.note", { style: { marginTop: "16px", maxWidth: "720px" } }, ic("lock"),
        h("div", sys.needs.help, sys.needs.link ? h("div", { style: { marginTop: "10px" } }, h("a.btn.small", { href: sys.needs.link.href, target: "_blank", rel: "noopener", "data-nav": "" }, ic("download"), sys.needs.link.label)) : null)) : null,
      sys.locked && !sys.needs ? h("div.note", { style: { marginTop: "16px", maxWidth: "720px" } }, ic("lock"),
        h("div", `${sys.short} needs the console's BIOS (${sys.biosFiles.map((f) => f.name).join(" or ")}). Drop it into the BIOS folder or onto this window and these games unlock.`)) : null));

  if (!games.length) {
    el.append(h("div.page", emptyState({
      art: consoleArt(sys, "big"),
      title: `No ${sys.short} games yet`,
      text: `Drop ${sys.exts.slice(0, 3).map((e) => `.${e}`).join(", ")} files onto this window, or copy them into ROMs/${sys.folder} on the server.`,
      actions: [h("button.btn.primary", { "data-nav": "", onclick: () => window.phosphor.pickFiles() }, ic("upload"), "Add games"), h("button.btn", { "data-nav": "", onclick: folderSheet }, ic("folder"), "Show folders")],
    })));
    return { el, title: sys.name, accent: sys.color, ambient: [sys.color, "#0b0c12", sys.color] };
  }

  el.append(
    h("div.toolbar",
      h("label.field.search", ic("search"), searchInput),
      h("label.field", { style: { flex: "0 0 auto" } }, ic("sliders"),
        h("select", { "aria-label": "Sort", onchange: (e) => { st.sort = e.target.value; apply(); } }, SORTS.map(([v, l]) => h("option", { value: v, selected: v === st.sort }, l)))),
      genres.length > 1 ? h("label.field", { style: { flex: "0 0 auto" } },
        h("select", { "aria-label": "Genre", onchange: (e) => { st.genre = e.target.value; apply(); } }, h("option", { value: "" }, "All genres"), genres.map((g) => h("option", { value: g }, g)))) : null,
      h("div.chips", chip("all", "All"), chip("fav", "Favorites"), chip("played", "Played"), chip("new", "Never played"), chip("multi", "2+ players")),
      h("button.btn.small.ghost", { "data-nav": "", style: { marginLeft: "auto" }, onclick: async () => {
        const pool = list.length ? list : games;
        const g = pool[Math.floor(Math.random() * pool.length)];
        toast({ title: `How about ${g.title}?`, icon: "shuffle", img: g.box });
        go(`/game/${g.id}`);
      } }, ic("shuffle"), "Surprise me")),
    h("div.page", { style: { paddingTop: "10px" } }, grid, empty, sentinel));
  apply();
  io.observe(sentinel);
  const rgb = hexToRgb(sys.color);
  return {
    el, title: sys.name, accent: sys.color, ambient: [sys.color, `rgb(${rgb.map((x) => Math.round(x * 0.4)).join(",")})`, "#0b0c12"],
    destroy: () => io.disconnect(),
  };
}
