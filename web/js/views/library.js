import { store, go } from "../store.js";
import { api } from "../api.js";
import { h, ic, plural, sheet } from "../ui.js";
import { gameBrowser } from "../browse.js";
import { sysCard } from "./home.js";
import { freeGamesSheet } from "../freegames.js";

const KIND_LABEL = { console: "Home consoles", handheld: "Handhelds", arcade: "Arcade", computer: "Computers" };

// Library: every console (Consoles) or every game across them with filters (Games). The last
// one used opens next time.
const VIEW_KEY = "phosphor.library.view";

export default async function library({ query = {} } = {}) {
  const all = store.systemList;
  const withGames = all.filter((s) => s.count > 0);
  const ready = all.filter((s) => s.count === 0 && !s.locked);
  const total = withGames.reduce((a, s) => a + s.count, 0);
  const view = query.view || localStorage.getItem(VIEW_KEY) || "consoles";
  localStorage.setItem(VIEW_KEY, view);
  const switcher = h("div.segmented.lib-switch",
    h("button", { "data-nav": "", class: view === "consoles" ? "on" : "", onclick: () => view !== "consoles" && go("/library?view=consoles") }, ic("layers"), "Consoles"),
    h("button", { "data-nav": "", class: view === "games" ? "on" : "", onclick: () => view !== "games" && go("/library?view=games") }, ic("library"), "Games"));
  const head = h("div.page-head",
    h("div.grow", h("div.eyebrow", "Library"), h("h1", total ? plural(total, "game") : "Your consoles"),
      h("div.sub", view === "games" ? `Every game on ${plural(withGames.length, "console")}.` : `${withGames.length} of ${all.filter((s) => !s.locked).length} consoles have games. Every emulator is already installed.`)),
    switcher,
    h("button.btn", { "data-nav": "", onclick: () => freeGamesSheet() }, ic("gift"), "Free games"),
    h("button.btn", { "data-nav": "", onclick: () => folderSheet() }, ic("folder"), "Where do games go?"),
    h("button.btn.primary", { "data-nav": "", onclick: () => window.phosphor.pickFiles() }, ic("upload"), "Add games"));

  if (view === "games" && total) {
    const games = await api.get("/api/games");
    const browser = gameBrowser({ games, key: "games", query });
    const el = h("div", h("div.page", { style: { paddingBottom: 0 } }, head), browser.toolbar, browser.body);
    return { el, title: "Games", destroy: browser.destroy };
  }

  const el = h("div.page", head);

  if (withGames.length) {
    el.append(h("div.sys-section", h("div.systems", withGames.sort((a, b) => b.count - a.count).map(sysCard))));
  }
  if (ready.length) {
    const byKind = {};
    for (const s of ready) (byKind[s.kind] ||= []).push(s);
    el.append(h("div.sys-section", h("h3", withGames.length ? "Ready when you are" : "Ready to play"),
      ...Object.entries(byKind).map(([k, list]) => h("div", { style: { marginBottom: "26px" } },
        h("div", { style: { color: "var(--text-2)", fontWeight: 600, fontSize: "14px", margin: "0 0 12px" } }, KIND_LABEL[k] || k),
        h("div.systems", list.map(sysCard))))));
  }
  // Desktop consoles waiting for a file only the player can supply (BIOS, keys, firmware).
  const needing = all.filter((s) => s.count === 0 && s.locked && s.needs);
  if (needing.length) {
    el.append(h("div.sys-section", h("h3", "Needs a file from you"),
      h("p", { style: { color: "var(--text-2)", margin: "-4px 0 14px", maxWidth: "70ch" } }, "These consoles need something from your own console (or Sony's free system software). Open one to see exactly which file, then drop it onto this window."),
      h("div.systems", needing.map(sysCard))));
  }
  // Consoles that need a copyrighted BIOS are left out entirely. Only mention them if the user
  // actually has games for one, so those games don't seem to vanish.
  const waiting = (store.state.hiddenSystems || []).filter((x) => x.games);
  if (waiting.length) {
    el.append(h("div.note", { style: { marginTop: "30px" } }, ic("info"),
      h("div", waiting.map((x) => `${x.games} ${x.name} game${x.games === 1 ? "" : "s"}`).join(", "),
        " can't run without that console's own BIOS, which is copyrighted, so they're hidden. If you own it, drop ",
        waiting.map((x) => x.biosFiles[0]).join(" / "), " into the BIOS folder and they'll appear.")));
  }
  return { el, title: "Library" };
}

export function folderSheet() {
  const lib = store.state.library;
  const sep = lib.root.includes("\\") ? "\\" : "/";
  const body = h("div",
    h("p", { style: { color: "var(--text-2)", marginTop: 0 } }, "Easiest: drop games anywhere on this window, or copy them into the drop folder. Phosphor works out the console and files them for you."),
    h("div.kv",
      h("div", h("dt", "Drop folder (auto-sorts)"), h("dd", lib.dropFolder)),
      h("div", h("dt", "Game folders"), h("dd", `${lib.root}${sep}ROMs${sep}<console>`)),
      h("div", h("dt", "Your saves"), h("dd", `${lib.root}${sep}Saves`)),
      h("div", h("dt", "BIOS (only if needed)"), h("dd", `${lib.root}${sep}BIOS`))),
    h("h3", { style: { margin: "22px 0 10px", fontSize: "15px" } }, "Folder for each console"),
    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "6px 16px", fontSize: "13.5px" } },
      store.systemList.map((s) => h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", padding: "6px 0", borderTop: "1px solid var(--stroke)" } },
        h("span", { style: { fontWeight: 600 } }, s.folder), h("span", { style: { color: "var(--text-3)" } }, s.exts.slice(0, 4).map((e) => `.${e}`).join(" "))))));
  sheet({ title: "Where your games live", body, wide: true, actions: [{ label: "Got it", kind: "primary" }] });
}
