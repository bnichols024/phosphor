import { api } from "../api.js";
import { store, go } from "../store.js";
import { h, ic, gameCard, plural, promptBox, confirmBox, emptyState, toast } from "../ui.js";
import { ICONS } from "../icons.js";

export default async function collections({ params }) {
  if (params.id) return one(Number(params.id));
  const cols = await api.get("/api/collections");
  const create = async () => {
    const name = await promptBox("New shelf", { placeholder: "Couch co-op, RPG marathon…", ok: "Create" });
    if (!name) return;
    const c = await api.post("/api/collections", { name });
    go(`/collection/${c.id}`);
  };
  const el = h("div.page",
    h("div.page-head",
      h("div.grow", h("div.eyebrow", "Shelves"), h("h1", "Your shelves"), h("div.sub", "Group games however you like. Add from any game's page.")),
      h("button.btn.primary", { "data-nav": "", onclick: create }, ic("plus"), "New shelf")));
  if (!cols.length) {
    el.append(emptyState({ iconSvg: ICONS.layers, title: "No shelves yet", text: "Make one for party games, a childhood favorites list, or what you're playing through next.", actions: [h("button.btn.primary", { "data-nav": "", onclick: create }, ic("plus"), "Make a shelf")] }));
  } else {
    el.append(h("div.collections-grid", cols.map((c) => h("a.coll", { href: `/collection/${c.id}`, "data-nav": "" },
      h("div.mosaic", [0, 1, 2, 3].map((i) => h("div", { style: c.covers[i] ? { backgroundImage: `url("${c.covers[i]}")` } : null }))),
      h("div.cap", h("b", c.name), h("span", plural(c.count, "game")))))));
  }
  return { el, title: "Shelves" };
}

async function one(id) {
  const cols = await api.get("/api/collections");
  const c = cols.find((x) => x.id === id);
  if (!c) throw new Error("That shelf doesn't exist anymore.");
  const games = await api.get(`/api/games?collection=${id}`);
  const el = h("div.page",
    h("div.page-head",
      h("div.grow", h("a.eyebrow", { href: "/collections", "data-nav": "" }, "Shelves"), h("h1", c.name), h("div.sub", plural(games.length, "game"))),
      h("button.btn", { "data-nav": "", onclick: async () => {
        const name = await promptBox("Rename shelf", { value: c.name, ok: "Rename" });
        if (!name) return;
        await api.patch(`/api/collections/${id}`, { name });
        go(`/collection/${id}`);
      } }, ic("edit"), "Rename"),
      h("button.btn.ghost.danger", { "data-nav": "", onclick: async () => {
        if (!(await confirmBox(`Delete "${c.name}"?`, "The games stay in your library; only the shelf goes.", { ok: "Delete", danger: true }))) return;
        await api.del(`/api/collections/${id}`);
        toast({ title: "Shelf deleted", icon: "trash" });
        go("/collections");
      } }, ic("trash"))),
    games.length ? h("div.grid", games.map((g) => gameCard(g, { systems: store.systems, onOpen: (x) => go(`/game/${x.id}`) })))
      : emptyState({ iconSvg: ICONS.layers, title: "This shelf is empty", text: "Open any game and use the shelf button to add it here." }));
  return { el, title: c.name };
}
