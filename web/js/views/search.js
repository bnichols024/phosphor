import { api } from "../api.js";
import { store, go } from "../store.js";
import { h, ic, gameCard, plural } from "../ui.js";
import { groupVariants } from "./system.js";

export default async function search({ query }) {
  const all = await api.get("/api/games");
  const favoritesOnly = query.favorites === "1";
  const input = h("input", { type: "search", placeholder: "Search every game you own", value: query.q || "", autocomplete: "off", "aria-label": "Search", id: "search-input" });
  const results = h("div.grid");
  const info = h("div", { style: { color: "var(--text-3)", fontWeight: 600, margin: "0 0 16px" } });
  const sysChips = h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "20px" } });
  let sysFilter = null;

  const run = () => {
    const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let out = all;
    if (favoritesOnly) out = out.filter((g) => g.favorite);
    if (words.length) {
      out = out.filter((g) => {
        const hay = `${g.title} ${g.genre || ""} ${store.systems[g.system]?.short || ""} ${g.year || ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }
    const systemsHit = [...new Set(out.map((g) => g.system))];
    sysChips.replaceChildren(...(systemsHit.length > 1 ? [h("button.chip", { "data-nav": "", class: !sysFilter ? "on" : "", onclick: () => { sysFilter = null; run(); } }, "All"),
      ...systemsHit.map((s) => h("button.chip", { "data-nav": "", class: sysFilter === s ? "on" : "", onclick: () => { sysFilter = sysFilter === s ? null : s; run(); } }, store.systems[s]?.short || s))] : []));
    if (sysFilter) out = out.filter((g) => g.system === sysFilter);
    if (store.settings.groupRegions) out = groupVariants(out, store.settings.regionOrder || ["US", "World", "EU", "JP"]);
    // Titles that start with the query come first.
    const q = words.join(" ");
    out = [...out].sort((a, b) => (b.title.toLowerCase().startsWith(q) - a.title.toLowerCase().startsWith(q)) || (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.title.localeCompare(b.title));
    const shown = out.slice(0, 240);
    results.replaceChildren(...shown.map((g) => gameCard(g, { systems: store.systems, onOpen: (x) => go(`/game/${x.id}`) })));
    info.textContent = words.length || favoritesOnly ? `${plural(out.length, "result")}${out.length > shown.length ? ` · showing ${shown.length}` : ""}` : `${plural(all.length, "game")} in your library`;
    const url = new URL(location.href);
    if (input.value) url.searchParams.set("q", input.value); else url.searchParams.delete("q");
    history.replaceState(history.state, "", url.pathname + url.search);
  };
  let t;
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 90); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") results.querySelector(".gcard")?.focus(); });
  run();

  const el = h("div.page",
    h("div.page-head", h("div.grow", h("div.eyebrow", favoritesOnly ? "Favorites" : "Search"), h("h1", favoritesOnly ? "Your favorites" : "Find a game"))),
    h("label.search-big", ic("search"), input, h("kbd.key", "/")),
    sysChips, info, results);
  setTimeout(() => { if (!document.body.classList.contains("pad")) input.focus(); }, 60);
  return { el, title: "Search", autofocus: "#search-input" };
}
