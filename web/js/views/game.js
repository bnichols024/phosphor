import { api } from "../api.js";
import { store, go } from "../store.js";
import { h, ic, svg, fmtTime, timeAgo, fmtBytes, toast, toastError, sheet, confirmBox, promptBox, imageColor, setAmbient, hexToRgb } from "../ui.js";
import { consoleIcon } from "../icons.js";
import { sound } from "../sound.js";

export default async function gameView({ params }) {
  const g = await api.get(`/api/games/${params.id}`);
  const sys = store.systems[g.system] || g.systemInfo;
  const play = (q = "") => { sound.play("select"); window.phosphor.leaveTo(`/play/${g.id}${q}`); };
  const auto = g.states.find((s) => s.slot === 0);

  const backdropSrc = auto?.thumb || g.snap || g.titleArt || g.box;
  const boxEl = h("div.game-box", { "--ar": sys.box || 0.75 });
  if (g.box) {
    const img = h("img", { src: g.box, alt: `${g.title} box art` });
    img.addEventListener("load", () => {
      const c = imageColor(img);
      if (c) { boxEl.style.setProperty("--glow-rgb", c.join(",")); setAmbient([c, sys.color, "#0b0c12"]); }
    }, { once: true });
    boxEl.append(img);
  } else {
    const el = h("div.cover-gen", { "--sys": sys.color }, h("div.t", g.title), h("div.s", sys.short));
    const i = svg(consoleIcon(sys.icon)); i.classList.add("ico"); el.prepend(i);
    boxEl.append(el);
  }

  const favBtn = h("button.btn.big.icon", { "data-nav": "", "aria-label": "Favorite", class: g.favorite ? "on" : "", onclick: async () => {
    g.favorite = !g.favorite;
    favBtn.replaceChildren(ic(g.favorite ? "heartFill" : "heart"));
    favBtn.classList.toggle("on", g.favorite);
    sound.play(g.favorite ? "success" : "back");
    await api.post(`/api/games/${g.id}/favorite`, { favorite: g.favorite }).catch(toastError);
  } }, ic(g.favorite ? "heartFill" : "heart"));

  const meta = [
    h("span.chip.solid", sys.short),
    g.year ? h("span.chip", String(g.year)) : null,
    g.genre ? h("span.chip", g.genre) : null,
    g.players ? h("span.chip", ic("users"), g.players === 1 ? "1 player" : `1–${g.players} players`) : null,
    g.region ? h("span.chip", g.region) : null,
    g.discs > 1 ? h("span.chip", ic("disc"), `${g.discs} discs`) : null,
    g.patch ? h("span.chip", { title: "Applied automatically when you play" }, ic("sparkles"), `Patched: ${g.patch}`) : null,
    g.seconds ? h("span.chip", ic("clock"), `${fmtTime(g.seconds)} played`) : null,
    g.lastPlayed ? h("span.chip", `Last played ${timeAgo(g.lastPlayed)}`) : null,
  ];

  const locked = sys.locked;
  const actions = h("div.game-actions",
    locked ? h("button.btn.big", { disabled: true }, ic("lock"), "Needs BIOS")
      : auto ? [
        h("button.btn.primary.big#play-btn", { "data-nav": "", onclick: () => play("?resume=1") }, ic("resume"), "Resume"),
        h("button.btn.big", { "data-nav": "", onclick: () => play() }, ic("play"), "Start fresh"),
      ] : h("button.btn.primary.big#play-btn", { "data-nav": "", onclick: () => play() }, ic("play"), "Play"),
    favBtn,
    h("button.btn.big.icon", { "data-nav": "", "aria-label": "Add to a shelf", onclick: () => shelfSheet(g) }, ic("layers")),
    h("button.btn.big.icon.hide-kid", { "data-nav": "", "aria-label": "More", onclick: () => moreSheet(g) }, ic("more")));

  const el = h("div.game-page", { "--sys": sys.color },
    h("div.game-backdrop", backdropSrc ? h("img", { src: backdropSrc, alt: "" }) : null),
    h("div.game-top", boxEl,
      h("div.game-info",
        h("a.eyebrow", { href: `/system/${g.system}`, "data-nav": "" }, sys.name),
        h("h1", g.title),
        h("div.meta", meta),
        actions,
        locked ? h("div.note", { style: { marginTop: "16px", maxWidth: "640px" } }, ic("lock"), h("div", `Drop ${sys.biosFiles[0]?.name || "the BIOS"} into the BIOS folder to unlock ${sys.short} games.`)) : null)));

  // Save states
  const states = h("div.states");
  const renderStates = (list) => {
    states.replaceChildren(...list.map((s) => {
      const card = h("button.state", { "data-nav": "", class: s.slot === 0 ? "auto" : "", onclick: () => play(s.slot === 0 ? "?resume=1" : `?state=${s.slot}`) },
        h("div.shot", h("img", { src: s.thumb, alt: "", loading: "lazy", onerror: (e) => e.target.remove() })),
        h("div.cap", h("b", s.slot === 0 ? "Where you left off" : `Slot ${s.slot}`), h("span", timeAgo(s.createdAt))));
      card.addEventListener("pad-x", () => del(s));
      card.addEventListener("contextmenu", (e) => { e.preventDefault(); del(s); });
      return card;
    }));
  };
  const del = async (s) => {
    if (!(await confirmBox("Delete this save state?", s.slot === 0 ? "Next time you'll start from your in-game save instead." : `Slot ${s.slot} will be gone for good.`, { ok: "Delete", danger: true }))) return;
    await api.del(`/api/games/${g.id}/states/${s.slot}`);
    g.states = g.states.filter((x) => x.slot !== s.slot);
    renderStates(g.states);
  };
  if (g.states.length) {
    renderStates(g.states);
    el.append(h("section.section", h("h2", "Save states", h("span.sub", "Pick one to jump straight back in · right-click or X to delete")), states));
  }

  // In-game save
  if (g.save) {
    el.append(h("section.section", h("h2", "In-game save"),
      h("div.list-item", ic("save"),
        h("div.grow", h("div.t", `Saved ${timeAgo(g.save.updatedAt)}`), h("div.d", `${fmtBytes(g.save.size)} · synced to every device you play on · older versions kept`)),
        h("button.btn.small", { "data-nav": "", onclick: () => historySheet(g) }, ic("history"), "Versions"))));
  }

  // Screenshots taken in-game (F8 or the menu)
  const shots = await api.get(`/api/games/${g.id}/screenshots`).catch(() => []);
  if (shots.length) {
    el.append(h("section.section", h("h2", "Screenshots & clips", h("span.sub", `${shots.length} · saved in Screenshots/${store.profile.name}/${sys.folder}`)),
      h("div.states", shots.slice(0, 24).map((sh) => h("a.state", { href: sh.url, target: "_blank", rel: "noopener", "data-nav": "" },
        h("div.shot", sh.kind === "video" ? h("video", { src: sh.url, preload: "metadata", muted: true, style: { width: "100%", height: "100%", objectFit: "contain" } }) : h("img", { src: sh.url, alt: "", loading: "lazy" })),
        h("div.cap", h("b", sh.kind === "video" ? "Clip" : "Screenshot"), h("span", timeAgo(sh.at))))))));
  }

  if (g.variants.length) {
    el.append(h("section.section", h("h2", "Other versions"),
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
        g.variants.map((v) => h("a.btn.small", { href: `/game/${v.id}`, "data-nav": "" }, v.region || "Version", v.tags.length ? ` · ${v.tags.join(", ")}` : "")))));
  }

  el.append(h("section.section", h("h2", "Details"),
    h("dl.kv",
      g.developer ? kv("Developer", g.developer) : null,
      g.publisher ? kv("Publisher", g.publisher) : null,
      kv("Times played", String(g.playCount)),
      kv("File", g.file),
      kv("Size", fmtBytes(g.size) + (g.fileCount > 1 ? ` in ${g.fileCount} files` : "")),
      kv("Folder", g.folder),
      g.crc ? kv("Checksum", `CRC32 ${g.crc}${g.matched ? " · verified" : ""}`) : null,
      kv("Match", g.matched ? (g.dbName || "Matched") : "Not in the database, using the file name"))));

  const rgb = hexToRgb(sys.color);
  return { el, title: g.title, accent: sys.color, ambient: [sys.color, `rgb(${rgb.map((x) => Math.round(x * 0.5)).join(",")})`, "#0b0c12"], autofocus: "#play-btn" };
}

const kv = (k, v) => h("div", h("dt", k), h("dd", v));

async function shelfSheet(g) {
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

function moreSheet(g) {
  const s = sheet({
    title: g.title,
    body: h("div.list",
      h("button.list-item", { "data-nav": "", onclick: async () => {
        s.close();
        const t = await promptBox("Rename game", { value: g.title, ok: "Rename" });
        if (t === null) return;
        await api.patch(`/api/games/${g.id}`, { title: t });
        go(`/game/${g.id}`);
      } }, ic("edit"), h("div.grow", h("div.t", "Rename"), h("div.d", "Change how the title shows in your library"))),
      h("button.list-item", { "data-nav": "", onclick: async () => {
        s.close();
        const input = h("input", { type: "file", accept: "image/*" });
        input.onchange = async () => {
          const f = input.files[0];
          if (!f) return;
          await api.put(`/api/games/${g.id}/art/box`, f, { headers: { "content-type": f.type } }).catch(toastError);
          toast({ title: "Cover updated", icon: "check", kind: "good" });
          go(`/game/${g.id}`);
        };
        input.click();
      } }, ic("camera"), h("div.grow", h("div.t", "Use my own cover"), h("div.d", "Pick an image from this device"))),
      h("button.list-item", { "data-nav": "", onclick: async () => {
        s.close();
        await api.post(`/api/games/${g.id}/refetch-art`);
        toast({ title: "Looking for box art again", text: "It'll appear in a moment if we find it.", icon: "refresh" });
      } }, ic("refresh"), h("div.grow", h("div.t", "Find box art again"))),
      h("a.list-item", { href: `/api/games/${g.id}/download`, download: "", "data-nav": "" }, ic("download"), h("div.grow", h("div.t", "Download game file"), h("div.d", g.file)))),
    actions: [{ label: "Close", kind: "ghost" }],
  });
}

async function historySheet(g) {
  const list = await api.get(`/api/games/${g.id}/save/history`);
  const s = sheet({
    title: "Save versions",
    sub: "Phosphor keeps your last few in-game saves. Restoring one keeps the current save as a version too.",
    body: list.length ? h("div.list", list.map((v) => h("button.list-item", { "data-nav": "", onclick: async () => {
      if (!(await confirmBox("Restore this save?", `Your game will continue from ${new Date(v.at).toLocaleString()}.`, { ok: "Restore" }))) return;
      await api.post(`/api/games/${g.id}/save/restore`, { at: v.at }).catch(toastError);
      s.close();
      toast({ title: "Save restored", icon: "check", kind: "good" });
    } }, ic("history"), h("div.grow", h("div.t", new Date(v.at).toLocaleString()), h("div.d", `${fmtBytes(v.size)} · ${timeAgo(v.at)}`))))) : h("p", { style: { color: "var(--text-2)" } }, "No older versions yet. They appear after your next few saves."),
    actions: [{ label: "Close", kind: "ghost" }],
  });
}
