// Desktop app only: tells the player when a new Phosphor is out and installs it (the work happens
// in desktop/updater.mjs). Windows and Linux AppImages update in place; elsewhere the button opens
// the download page. "Later" hides the panel until the next launch.
import { h, $, ic } from "./ui.js";

const api = () => window.phosphorDesktop?.update;
let panel = null;
let hidden = false;
const listeners = new Set();
let last = null;

export function initUpdates() {
  if (!api()) return;
  api().onChange((s) => { last = s; listeners.forEach((fn) => fn(s)); show(s); });
  api().state().then((s) => { last = s; show(s); });
}

// For Settings › About: current state now and on every change; returns an unsubscribe.
export function watchUpdates(fn) {
  if (!api()) return () => {};
  listeners.add(fn);
  if (last) fn(last); else api().state().then(fn);
  return () => listeners.delete(fn);
}
export const updates = {
  available: () => !!api(),
  check: () => api()?.check(),
  start: () => api()?.start(),
  restart: () => api()?.restart(),
};

function show(s) {
  const wanted = ["available", "downloading", "ready"].includes(s.state) || (s.state === "error" && panel);
  if (!wanted || hidden) { if (!wanted) close(); return; }
  if (!panel) {
    panel = h("div.uploads.update-panel", { role: "status" },
      h("h4", h("span.up-title", ""), h("span.up-pct", "")),
      h("div.up-text", ""),
      h("div.bar", h("i")),
      h("div.update-actions"));
    document.body.append(panel);
  }
  const title = $(".up-title", panel), pct = $(".up-pct", panel), text = $(".up-text", panel), bar = $(".bar", panel), actions = $(".update-actions", panel);
  const later = () => h("button.up-cancel", { "data-nav": "", onclick: () => { hidden = true; close(); } }, "Later");
  bar.style.display = s.state === "downloading" ? "" : "none";
  pct.textContent = s.state === "downloading" ? `${s.percent || 0}%` : "";
  $("i", bar).style.width = `${s.percent || 0}%`;
  actions.replaceChildren();
  if (s.state === "available") {
    title.textContent = `Phosphor ${s.version} is out`;
    text.textContent = s.inApp ? `You have ${s.current}. It downloads in the background; your games and saves stay as they are.` : `You have ${s.current}. Download it from the release page and install it over this one.`;
    actions.append(h("button.btn.small.primary", { "data-nav": "", onclick: () => api().start() }, ic("download"), s.inApp ? "Update" : "Download"), later());
  } else if (s.state === "downloading") {
    title.textContent = `Downloading Phosphor ${s.version}`;
    text.textContent = "Keep playing. You'll be asked to restart when it's ready.";
  } else if (s.state === "ready") {
    title.textContent = `Phosphor ${s.version} is ready`;
    text.textContent = "Restart to finish. If you'd rather not now, it installs the next time you close Phosphor.";
    actions.append(h("button.btn.small.primary", { "data-nav": "", onclick: () => api().restart() }, ic("restart"), "Restart now"), later());
  } else if (s.state === "error") {
    title.textContent = "Update didn't finish";
    text.textContent = s.error || "Something went wrong.";
    actions.append(h("button.btn.small", { "data-nav": "", onclick: () => api().start() }, ic("refresh"), "Try again"), later());
  }
}

function close() { panel?.remove(); panel = null; }
