// "Free games" sheet: one-click installs of homebrew games their authors give away.
import { api } from "./api.js";
import { store, go } from "./store.js";
import { h, ic, consoleArt, sheet, toast, toastError } from "./ui.js";
import { sound } from "./sound.js";

export async function freeGamesSheet() {
  let games = await api.get("/api/free-games");
  const list = h("div.list");
  const draw = () => {
    list.replaceChildren(...games.map((g) => {
      const sys = store.systems[g.system];
      const i = consoleArt(sys, "fg-art");
      const btn = g.installed
        ? h("button.btn.small", { "data-nav": "", onclick: () => { s.close(); if (g.gameId) go(`/game/${g.gameId}`); else go(`/system/${g.system}`); } }, ic("play"), "Open")
        : h("button.btn.small.primary", { "data-nav": "", onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          b.replaceChildren(ic("download"), "Getting it…");
          try {
            await api.post(`/api/free-games/${g.id}/install`);
            sound.play("success");
            toast({ title: `${g.title} is ready`, text: `Added to ${sys?.short}.`, icon: "gift", kind: "good" });
            games = await api.get("/api/free-games");
            draw();
          } catch (err) { toastError(err); b.disabled = false; b.replaceChildren(ic("download"), "Get"); }
        } }, ic("download"), "Get");
      return h("div.list-item", { style: { alignItems: "flex-start" } },
        h("div", { style: { width: "56px", height: "56px", borderRadius: "14px", flex: "none", display: "grid", placeItems: "center", background: `linear-gradient(140deg, ${sys?.color || "#7c5cff"}, #12131c)` } }, i),
        h("div.grow",
          h("div.t", g.title, h("span", { style: { color: "var(--text-3)", fontWeight: 500, marginLeft: "8px", fontSize: "13px" } }, `${sys?.short} · ${g.genre}`)),
          h("div.d", { style: { color: "var(--text-2)", margin: "3px 0" } }, g.blurb),
          h("div.d", `By ${g.author} · ${g.license} · `, h("a", { href: g.home, target: "_blank", rel: "noopener", style: { textDecoration: "underline" } }, "project page"))),
        btn);
    }));
  };
  draw();
  const s = sheet({
    title: "Free games",
    sub: "Great homebrew that the authors give away. Each one downloads from its author's own page.",
    body: list, wide: true,
    actions: [
      { label: "Close", kind: "ghost" },
      { label: "Get them all", kind: "primary", icon: "gift", onClick: async () => {
        try {
          await api.post("/api/free-games/all/install");
          sound.play("success");
          toast({ title: "Free games added", text: "They'll show up in a few seconds.", icon: "gift", kind: "good" });
        } catch (e) { toastError(e); return false; }
      } },
    ],
  });
}
