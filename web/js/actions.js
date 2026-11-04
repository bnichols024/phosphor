// Things you can do to a game from anywhere: play it, favorite it, set its backlog status, and the
// right-click menu on a game card. Cards, the game page and Home all use these.
import { api } from "./api.js";
import { h, ic, toast, toastError, sheet, promptBox } from "./ui.js";
import { sound } from "./sound.js";

export const STATUS = {
  playing: { label: "Playing", icon: "play", color: "#36e2c4" },
  beaten: { label: "Beaten", icon: "check", color: "#a3e635" },
  backlog: { label: "Backlog", icon: "clock", color: "#f59e0b" },
  dropped: { label: "Dropped", icon: "x", color: "#94a3b8" },
};

// Straight into the game (resuming where the player left off when there's a resume state).
export function playGame(g) {
  sound.play("select");
  window.phosphor.leaveTo(`/play/${g.id}${g.resumable ? "?resume=1" : ""}`);
}

// Every card (and the game page) showing this game updates together.
const listeners = new Set();
export const onGameChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = (g, patch) => { Object.assign(g, patch); for (const fn of listeners) fn(g.id, patch); };

export async function toggleFavorite(g) {
  const favorite = !g.favorite;
  try {
    await api.post(`/api/games/${g.id}/favorite`, { favorite });
    changed(g, { favorite });
    sound.play(favorite ? "success" : "back");
    toast({ title: favorite ? "Added to favorites" : "Removed from favorites", text: g.title, icon: favorite ? "heartFill" : "heart", img: g.box, timeout: 2200 });
  } catch (e) { toastError(e); }
}

export async function setStatus(g, status) {
  const next = g.status === status ? null : status;
  try {
    await api.post(`/api/games/${g.id}/status`, { status: next });
    changed(g, { status: next });
    sound.play(next ? "success" : "back");
    toast({ title: next ? `Marked ${STATUS[next].label.toLowerCase()}` : "Status cleared", text: g.title, icon: next ? STATUS[next].icon : "x", img: g.box, timeout: 2200 });
  } catch (e) { toastError(e); }
}

// The four status chips (game page, menus). Pad-friendly buttons.
export function statusChips(g) {
  const wrap = h("div.chips.status-chips");
  const draw = () => wrap.replaceChildren(...Object.entries(STATUS).map(([k, s]) =>
    h("button.chip", { "data-nav": "", class: g.status === k ? "on" : "", "--st": s.color, onclick: () => setStatus(g, k) }, ic(s.icon), s.label)));
  draw();
  const off = onGameChange((id) => { if (id === g.id) { if (!wrap.isConnected) return off(); draw(); } });
  return wrap;
}

// Right-click on a card: the quick things without opening the game page.
export function cardMenu(g, x, y) {
  document.querySelector(".ctx-menu")?.remove();
  const close = () => { menu.remove(); window.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", esc, true); };
  const item = (icon, label, fn, on = false) => h("button.ctx-item", { "data-nav": "", class: on ? "on" : "", onclick: () => { close(); fn(); } }, ic(icon), label);
  const menu = h("div.ctx-menu", { role: "menu" },
    h("div.ctx-title", g.title),
    item(g.resumable ? "resume" : "play", g.resumable ? "Resume" : "Play", () => playGame(g)),
    item(g.favorite ? "heartFill" : "heart", g.favorite ? "Remove from favorites" : "Add to favorites", () => toggleFavorite(g)),
    h("div.ctx-sep"),
    ...Object.entries(STATUS).map(([k, s]) => item(s.icon, s.label, () => setStatus(g, k), g.status === k)),
    h("div.ctx-sep"),
    item("layers", "Add to a shelf…", () => shelfSheet(g)),
    item("info", "Details", () => window.phosphor.navigate(`/game/${g.id}`)));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  setTimeout(() => { window.addEventListener("pointerdown", outside, true); window.addEventListener("keydown", esc, true); }, 0);
  menu.querySelector(".ctx-item")?.focus({ preventScroll: true });
}

// Shelves (the player's own collections) this game is on, to add or remove it.
export async function shelfSheet(g) {
  const cols = await api.get("/api/collections");
  const fresh = await api.get(`/api/games/${g.id}`);
  const has = new Set(fresh.collections.filter((c) => c.has).map((c) => c.id));
  const body = h("div.list",
    cols.map((c) => {
      const item = h("button.list-item", { "data-nav": "", onclick: async () => {
        const on = !has.has(c.id);
        await api.post(`/api/collections/${c.id}/games`, { gameId: g.id, remove: !on });
        on ? has.add(c.id) : has.delete(c.id);
        item.querySelector(".mark").replaceChildren(on ? ic("check") : "");
        toast({ title: on ? `Added to ${c.name}` : `Removed from ${c.name}`, icon: "layers" });
      } }, ic("layers"), h("div.grow", h("div.t", c.name), h("div.d", `${c.count} games`)), h("span.mark", has.has(c.id) ? ic("check") : ""));
      return item;
    }),
    h("button.list-item", { "data-nav": "", onclick: async () => {
      s.close();
      const name = await promptBox("New shelf", { placeholder: "Couch co-op, RPG marathon…", ok: "Create" });
      if (!name) return;
      await api.post("/api/collections", { name, gameId: g.id });
      toast({ title: `Created ${name}`, text: `${g.title} is on it.`, icon: "layers", kind: "good" });
    } }, ic("plus"), h("div.grow", h("div.t", "New shelf…"))));
  const s = sheet({ title: "Add to a shelf", sub: "Shelves are your own collections, like playlists for games.", body, actions: [{ label: "Done", kind: "primary" }] });
}
