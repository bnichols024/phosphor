import { api } from "../api.js";
import { store, go, refreshState } from "../store.js";
import { h, ic, consoleArt, gameCard, plural, emptyState, hexToRgb, toast, toastError, confirmRollback, desktopLink } from "../ui.js";
import { sound } from "../sound.js";
import { folderSheet } from "./library.js";
import { gameBrowser } from "../browse.js";

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
    if (!(await confirmRollback(name, info.previous))) return;
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
  const icon = consoleArt(sys);
  const count = h("span", games.length ? plural(games.length, "game") : "No games yet");
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
        h("div", sys.needs.help, sys.missing?.length ? h("div", { style: { marginTop: "8px", fontWeight: 600 } }, `Still missing: ${sys.missing.join(", ")}`) : null,
          sys.needs.links?.length ? h("div", { style: { marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" } }, sys.needs.links.map((l) => h("a.btn.small", { href: l.href, target: "_blank", rel: "noopener", "data-nav": "" }, ic("download"), l.label))) : null)) : null,
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

  const browser = gameBrowser({ games, key: `system:${sys.id}`, fixedSystem: sys.id, ratio: sys.box, query });
  el.append(browser.toolbar, browser.body);
  const rgb = hexToRgb(sys.color);
  return {
    el, title: sys.name, accent: sys.color, ambient: [sys.color, `rgb(${rgb.map((x) => Math.round(x * 0.4)).join(",")})`, "#0b0c12"],
    destroy: browser.destroy,
  };
}
