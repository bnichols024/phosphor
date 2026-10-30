import { api } from "../api.js";
import { store, go } from "../store.js";
import { h, fmtTime, gameCard, emptyState } from "../ui.js";
import { ICONS } from "../icons.js";

export default async function stats() {
  const s = await api.get("/api/stats");
  const el = h("div.page",
    h("div.page-head", h("div.grow", h("div.eyebrow", `${store.profile.avatar} ${store.profile.name}`), h("h1", "Your play"), h("div.sub", "Play time is counted while a game is running and you're not paused."))));
  if (!s.gamesPlayed) {
    el.append(emptyState({ iconSvg: ICONS.chart, title: "Nothing played yet", text: "Start any game and your play time, streaks and favorites show up here." }));
    return { el, title: "Stats" };
  }
  const today = Math.floor(Date.now() / 86400000);
  const byDay = new Map(s.days.map((d) => [d.d, d.s]));
  const days = Array.from({ length: 30 }, (_, i) => today - 29 + i);
  const max = Math.max(60, ...days.map((d) => byDay.get(d) || 0));
  const weekTotal = days.slice(-7).reduce((a, d) => a + (byDay.get(d) || 0), 0);
  const sysMax = Math.max(1, ...s.bySystem.map((x) => x.s));

  el.append(
    h("div.tiles", { style: { padding: 0 } },
      tile("All time", fmtTime(s.totalSeconds), "#7c5cff"),
      tile("Last 7 days", fmtTime(weekTotal), "#36e2c4"),
      tile("Games played", String(s.gamesPlayed), "#ff5c8a"),
      tile("Day streak", `${s.streak}`, "#f59e0b", s.streak === 1 ? "day" : "days")),
    h("div.card", { style: { marginTop: "18px" } },
      h("h3", "Last 30 days"),
      h("div.bars", days.map((d) => {
        const v = byDay.get(d) || 0;
        return h("div.b", { class: v ? "" : "zero", style: { height: `${Math.max(2, (v / max) * 100)}%` }, "data-tip": `${new Date(d * 86400000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${fmtTime(v)}` });
      }))),
    s.bySystem.length ? h("div.card", h("h3", "By console"),
      s.bySystem.map((x) => {
        const sys = store.systems[x.system];
        return h("div.hbar", { "--c": sys?.color }, h("span", sys?.short || x.system), h("div.track", h("i", { style: { width: `${(x.s / sysMax) * 100}%` } })), h("span", fmtTime(x.s)));
      })) : null);
  if (s.top.length) {
    el.append(h("h2", { style: { font: "700 21px var(--display)", margin: "34px 0 14px" } }, "Most played"),
      h("div.grid", s.top.map((g) => gameCard(g, { systems: store.systems, onOpen: (x) => go(`/game/${x.id}`) }))));
  }
  return { el, title: "Stats" };
}

function tile(k, v, c, unit) {
  return h("div.tile", { "--c": c }, h("div.glow"), h("div.k", k), h("div.v", v, unit ? h("small", unit) : null));
}
