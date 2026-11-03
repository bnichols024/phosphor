import { api } from "../api.js";
import { store, go, refreshState } from "../store.js";
import { h, ic, toast, toastError, sheet, confirmBox, promptBox, timeAgo, plural, desktopLink, confirmRollback } from "../ui.js";
import { sound } from "../sound.js";
import { updates, watchUpdates } from "../update.js";
import { ACTIONS, DEFAULTS, POSITIONAL, PAD_BUTTONS, padName, keyName, layoutFor } from "../controls.js";

const SECTIONS = [
  ["emulators", "Emulators", "cpu"],
  ["controls", "Controls", "gamepad"],
  ["graphics", "Graphics", "monitor"],
  ["library", "Library & BIOS", "folder"],
  ["players", "Players", "users"],
  ["accounts", "Accounts", "star"],
  ["general", "General", "sliders"],
  ["about", "About", "info"],
];
const AVATARS = ["👾", "🍄", "⭐", "🦔", "🐉", "🚀", "🎯", "🕹️", "👻", "🐢", "🦊", "⚡", "🐱", "🐼", "🦖", "🏎️", "🎸", "🌮"];
const COLORS = ["#7c5cff", "#ff5c8a", "#22c55e", "#f59e0b", "#06b6d4", "#ef4444", "#a855f7", "#14b8a6", "#e11d48", "#3b82f6"];

export default async function settings({ params }) {
  const section = SECTIONS.some((s) => s[0] === params.section) ? params.section : "emulators";
  const content = h("div");
  const el = h("div.page",
    h("div.page-head", h("div.grow", h("div.eyebrow", "Settings"), h("h1", SECTIONS.find((s) => s[0] === section)[1]))),
    h("div.settings",
      h("nav", SECTIONS.map(([id, label, icn]) => h("button", { "data-nav": "", class: id === section ? "on" : "", onclick: () => go(`/settings/${id}`) }, ic(icn), label))),
      content));
  const render = { emulators, controls, graphics, library, players, accounts, general, about }[section];
  const cleanup = await render(content);
  return { el, title: "Settings", destroy: cleanup };
}

// ---------------- Emulators: the one button ----------------
async function emulators(root) {
  const R = 58, C = 2 * Math.PI * R;
  const ringSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ringSvg.setAttribute("viewBox", "0 0 132 132");
  ringSvg.innerHTML = `<defs><linearGradient id="ugrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9a6ff"/><stop offset="1" stop-color="#36e2c4"/></linearGradient></defs><circle class="track" cx="66" cy="66" r="${R}" fill="none" stroke-width="10"/>`;
  const progEl = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  for (const [k, v] of Object.entries({ class: "prog", cx: 66, cy: 66, r: R, fill: "none", "stroke-width": 10, "stroke-dasharray": C, "stroke-dashoffset": C })) progEl.setAttribute(k, v);
  ringSvg.append(progEl);
  const center = h("div.center");
  const ring = h("div.update-ring", ringSvg, center);
  const title = h("h3");
  const desc = h("p");
  const btn = h("button.btn.primary.big", { "data-nav": "", id: "update-btn" }, ic("refresh"), "Update");
  const rollback = h("button.btn.ghost", { "data-nav": "" }, ic("history"), "Undo last update");
  const changes = h("div.changes");
  const hero = h("div.update-hero", ring, h("div", title, desc, h("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" } }, btn, rollback), changes));

  let summary = store.state.emulators;
  const paint = (s = summary.state) => {
    const active = summary.active;
    const running = s.running;
    ring.classList.toggle("busy", running && !s.total);
    const pct = running && s.total ? s.done / s.total : s.phase === "done" || (s.check?.upToDate && !running) ? 1 : 0;
    progEl.setAttribute("stroke-dashoffset", String(C * (1 - pct)));
    btn.disabled = running;
    rollback.hidden = running || !summary.canRollback;
    if (running) {
      center.replaceChildren(s.total ? h("b", `${Math.round(pct * 100)}%`) : ic("refresh"));
      title.textContent = s.phase === "verifying" ? "Checking the new emulators…" : s.phase === "checking" ? "Looking for updates…" : "Updating emulators…";
      desc.textContent = s.total ? `${s.done} of ${s.total} · ${s.message}` : s.message;
      btn.replaceChildren(ic("refresh"), "Updating…");
    } else if (s.phase === "failed") {
      center.replaceChildren(ic("alert"));
      title.textContent = "Update didn't finish";
      desc.textContent = `${s.error || ""} Your emulators weren't changed. Try again in a bit.`;
      btn.replaceChildren(ic("refresh"), "Try again");
    } else if (!active) {
      center.replaceChildren(ic("download"));
      title.textContent = "Emulators aren't installed";
      desc.textContent = "Press Install to download every emulator (about 120 MB).";
      btn.replaceChildren(ic("download"), "Install");
    } else if (s.check && !s.check.upToDate) {
      center.replaceChildren(h("b", String(s.check.changes.length)));
      title.textContent = `${plural(s.check.changes.length, "update")} available`;
      desc.textContent = "One press updates everything. Your games and saves aren't touched, and you can undo it.";
      btn.replaceChildren(ic("download"), "Update now");
      changes.replaceChildren(...s.check.changes.slice(0, 18).map((c) => h("span.chip", `${c.name} ${c.from ? `${c.from} → ` : ""}${c.to}`)));
    } else {
      center.replaceChildren(ic("check"));
      title.textContent = s.phase === "done" && s.message ? s.message : "Everything's up to date";
      const when = s.lastCheck ? `Checked ${timeAgo(Date.parse(s.lastCheck))}. ` : "";
      desc.textContent = `${when}EmulatorJS ${active.runtime} with ${Object.keys(active.cores || {}).length} emulator cores, installed ${timeAgo(Date.parse(active.installedAt))}.`;
      btn.replaceChildren(ic("refresh"), "Update");
      changes.replaceChildren();
    }
  };
  paint();

  btn.onclick = async () => {
    sound.play("select");
    try { await api.post("/api/emulators/update"); } catch (e) { toastError(e); }
  };
  rollback.onclick = async () => {
    if (!(await confirmBox("Go back to the previous emulators?", `You'll be on the version from ${summary.previous?.installedAt ? new Date(summary.previous.installedAt).toLocaleDateString() : "before the last update"}. You can update again any time.`, { ok: "Go back" }))) return;
    try { summary = await api.post("/api/emulators/rollback"); paint(); table(); toast({ title: "Previous emulators restored", icon: "history", kind: "good" }); } catch (e) { toastError(e); }
  };
  const onProgress = async (e) => {
    const s = e.detail;
    summary = { ...summary, state: s };
    if (s.phase === "done" || s.phase === "failed") {
      summary = await api.get("/api/emulators");
      if (s.phase === "done") { sound.play("success"); toast({ title: s.message || "Emulators updated", icon: "check", kind: "good" }); }
    }
    paint(s);
    table();
  };
  window.addEventListener("phosphor:emulators", onProgress);

  // One row per emulator: what it plays, its version, and its own Update / Previous version.
  const tableHost = h("div");
  const runItem = async (path, item, btn) => {
    btn.disabled = true;
    sound.play("select");
    try {
      if (path === "rollback") {
        summary = await api.post("/api/emulators/rollback", item);
        paint(); table();
        toast({ title: summary.state?.message || "Previous version restored", icon: "history", kind: "good" });
        // The version just left is now an update again.
        const check = await api.post("/api/emulators/check").catch(() => null);
        if (check) { summary = { ...summary, state: { ...summary.state, check, lastCheck: check.checkedAt } }; paint(); table(); }
      }
      else await api.post("/api/emulators/update", item);
    } catch (e) { toastError(e); btn.disabled = false; }
  };
  const table = () => {
    const running = summary.state?.running;
    const changes = summary.state?.check?.changes || [];
    const prev = summary.itemPrevious || { runtime: null, cores: {} };
    const rows = [];
    if (summary.active) rows.push({ kind: "runtime", id: "runtime", name: "EmulatorJS", plays: "Runs every in-browser emulator", version: summary.active.runtime, previous: prev.runtime, color: "#7c5cff" });
    const systems = store.systemList.filter((s) => !s.native);
    for (const core of Object.keys(summary.active?.cores || {})) {
      const uses = systems.filter((s) => (s.cores || [s.core]).includes(core));
      if (!uses.length) continue; // only consoles you can see (kid mode, BIOS-locked)
      rows.push({ kind: "core", id: core, name: coreName(core), plays: uses.map((s) => s.short).join(", "), version: summary.active.cores[core], previous: prev.cores[core] || null, color: uses[0].color, order: store.systemList.indexOf(uses[0]) });
    }
    rows.sort((a, b) => (a.order ?? -1) - (b.order ?? -1));
    for (const n of summary.native || []) {
      const uses = store.systemList.filter((s) => s.native === n.id);
      rows.push({ kind: "native", id: n.id, name: n.name, plays: uses.map((s) => s.short).join(", "), version: n.version, previous: n.previous, color: uses[0]?.color || "#7c5cff", desktop: true });
    }
    if (!store.state.desktop) {
      const desk = [...new Set(store.systemList.filter((s) => s.native).map((s) => s.nativeName))];
      if (desk.length) rows.push({ name: desk.join(", "), plays: store.systemList.filter((s) => s.native).map((s) => s.short).join(", "), version: null, note: "In the desktop app", color: "#475569", desktop: true });
    }
    tableHost.replaceChildren(h("table.core-table", h("tbody", rows.map((r) => {
      const change = r.kind && changes.find((c) => c.kind === r.kind && c.id === r.id);
      return h("tr",
        h("td", h("div.emu-name", h("span.sw", { "--c": r.color }), r.name, r.desktop ? h("span.chip", "Desktop") : null), h("div.emu-plays", r.plays)),
        h("td.ver", r.note || (r.version ? `v${r.version}` : "not installed"), change ? h("div.emu-new", `v${change.to} available`) : null),
        h("td.acts",
          change ? h("button.btn.small.primary", { "data-nav": "", disabled: running, onclick: (e) => runItem("update", { kind: r.kind, id: r.id }, e.currentTarget) }, ic("download"), "Update") : null,
          // A "previous" version that is really the newest one is offered as Update instead.
          r.previous && r.previous !== change?.to ? h("button.btn.small.ghost", { "data-nav": "", disabled: running, title: `Go back to v${r.previous}`, onclick: async (e) => {
            const b = e.currentTarget;
            if (!(await confirmRollback(r.name, r.previous))) return;
            runItem("rollback", { kind: r.kind, id: r.id }, b);
          } }, ic("history"), `v${r.previous}`) : null));
    }))));
  };
  table();

  root.append(hero,
    h("div.card", h("h3", "What's installed"), h("p", "Every console's emulator ships with Phosphor and works offline. The big Update button updates all of them at once; each one also has its own Update button when a new version is out, and a button to go back to the version it had before."), tableHost));

  if (!summary.state.running) {
    api.post("/api/emulators/check").then((check) => { summary = { ...summary, state: { ...summary.state, check, lastCheck: check.checkedAt } }; paint(); table(); }).catch(() => {});
  }
  return () => window.removeEventListener("phosphor:emulators", onProgress);
}

const coreName = (c) => store.state.emulators?.coreNames?.[c] || c;

// ---------------- Controls ----------------
const PAD_LABELS = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "LS", "RS", "↑", "↓", "←", "→", "Home"];
const saveProfileSettings = async (patch) => {
  const p = await api.patch(`/api/profiles/${store.profile.id}`, { settings: patch });
  store.profile = p;
  const i = store.profiles.findIndex((x) => x.id === p.id);
  if (i >= 0) store.profiles[i] = p;
  return p;
};

async function controls(root) {
  // Live controller test: what's plugged in and which buttons it's pressing right now.
  const padsHost = h("div.pads");
  const drawPads = () => {
    const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
    if (!pads.length) { if (!padsHost.querySelector(".none")) padsHost.replaceChildren(h("div.none", ic("gamepad"), h("div", h("b", "No controller found yet"), h("div", "Plug one in (or pair it over Bluetooth), then press any button on it."))));; return; }
    padsHost.replaceChildren(...pads.map((p) => h("div.pad-test",
      h("div.pad-name", ic("gamepad"), h("b", p.id.replace(/\s*\(.*$/, "") || "Controller"), h("span.chip", p.mapping === "standard" ? "Ready" : "Basic support")),
      h("div.pad-buttons", PAD_LABELS.map((l, i) => h("span", { class: p.buttons[i]?.pressed || (p.buttons[i]?.value || 0) > 0.5 ? "on" : "" }, l))),
      h("div.pad-sticks", [0, 2].map((a) => h("div.stick", h("i", { style: { left: `${50 + (p.axes[a] || 0) * 40}%`, top: `${50 + (p.axes[a + 1] || 0) * 40}%` } })))))));
  };
  drawPads();
  const padTimer = setInterval(drawPads, 80);

  // Button layout for the in-browser games, for all consoles or one.
  let ctl = JSON.parse(JSON.stringify(store.profile.settings?.controls || {}));
  let scope = "all";
  const consoles = store.systemList.filter((s) => !s.native);
  const scopeSel = h("select", { onchange: (e) => { scope = e.target.value; drawLayout(); } },
    h("option", { value: "all" }, "All consoles"), consoles.map((s) => h("option", { value: s.id }, s.name)));
  const layoutHost = h("div");
  let capture = null; // { kind: "key" | "pad", idx, cell }
  const save = async () => { try { await saveProfileSettings({ controls: ctl }); } catch (e) { toastError(e); } };
  const drawLayout = () => {
    const sc = (ctl[scope] ||= {});
    const eff = layoutFor(ctl, scope === "all" ? "__none__" : scope)[0];
    const positional = h("div.setting",
      h("div.grow", h("div.t", "Match button positions to the original controller"),
        h("div.d", "On: your bottom button is the console's bottom button (B on Nintendo pads). Off: buttons match by letter (your A is the console's A).")),
      toggle(!!sc.positional, (v) => { sc.positional = v; save(); drawLayout(); }));
    const rows = ACTIONS.map(([idx, label]) => {
      const own = sc.map?.[idx];
      const cell = (kind) => h("button.map-cell", { "data-nav": "", class: own && (kind === "key" ? "value" in own : "value2" in own) ? "custom" : "",
        onclick: (e) => startCapture(kind, idx, e.currentTarget) }, kind === "key" ? keyName(eff[idx]?.value) : padName(eff[idx]?.value2));
      return h("tr", h("td", label), h("td", cell("pad")), h("td", cell("key")));
    });
    layoutHost.replaceChildren(positional,
      h("table.map-table", h("thead", h("tr", h("th", "Button"), h("th", "Controller"), h("th", "Keyboard"))), h("tbody", rows)),
      h("div", { style: { display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" } },
        h("button.btn.ghost", { "data-nav": "", onclick: async () => { delete ctl[scope]; await save(); drawLayout(); toast({ title: scope === "all" ? "Layout reset" : `${store.systems[scope]?.short} uses your general layout again`, icon: "history" }); } }, ic("history"), scope === "all" ? "Reset to defaults" : "Use the general layout")));
  };
  const finish = (val) => {
    if (!capture) return;
    const { kind, idx } = capture;
    capture = null;
    window.removeEventListener("keydown", onKey, true);
    if (val !== undefined) {
      const sc = (ctl[scope] ||= {});
      sc.map ||= {};
      sc.map[idx] = { ...(sc.map[idx] || {}), [kind === "key" ? "value" : "value2"]: val };
      save();
    }
    drawLayout();
  };
  const onKey = (e) => {
    if (!capture || capture.kind !== "key") return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") return finish();
    finish(e.key === "Delete" || e.key === "Backspace" ? 0 : e.keyCode);
  };
  const startCapture = (kind, idx, cell) => {
    if (capture) finish();
    capture = { kind, idx, cell, since: performance.now() };
    cell.textContent = kind === "key" ? "Press a key… (Esc to cancel)" : "Press a button or move a stick…";
    cell.classList.add("listening");
    if (kind === "key") window.addEventListener("keydown", onKey, true);
  };
  // Controller capture: the first new button press (or a stick pushed far) after clicking.
  let held = new Set();
  const padCapture = setInterval(() => {
    const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
    const now = new Set();
    for (const p of pads) {
      p.buttons.forEach((b, i) => { if (b.pressed) now.add(`b${i}`); });
      p.axes.forEach((v, i) => { if (Math.abs(v) > 0.7) now.add(`a${i}${v > 0 ? "+" : "-"}`); });
    }
    if (capture?.kind === "pad" && performance.now() - capture.since > 250) {
      for (const k of now) {
        if (held.has(k)) continue;
        if (k[0] === "b") { const name = PAD_BUTTONS[Number(k.slice(1))]; if (name) { finish(name); break; } }
        else { const a = Number(k[1]); const stick = a < 2 ? "LEFT_STICK" : "RIGHT_STICK"; finish(`${stick}_${a % 2 ? "Y" : "X"}:${k.endsWith("+") ? "+1" : "-1"}`); break; }
      }
    }
    held = now;
  }, 40);
  drawLayout();

  root.append(
    h("div.card", h("h3", "Your controllers"),
      h("p", "Any controller works the moment it's plugged in: in Phosphor's menus, in every in-browser game, and set up for you in the desktop emulators where they allow it. Press buttons to test them."),
      padsHost),
    h("div.card", h("h3", "Buttons in games"),
      h("p", "These are your buttons for every in-browser console (NES to PSP). Pick a console to give it its own layout. Click a box, then press the button or key you want."),
      h("div.setting", h("div.grow", h("div.t", "Layout for")), h("label.field", { style: { width: "260px" } }, scopeSel)),
      layoutHost),
    desktopCard("controls"),
    h("div.card", h("h3", "Shortcuts"),
      h("div.kv",
        h("div", h("dt", "In menus"), h("dd", "A select · B back · X favorite · Y search · LB/RB sections")),
        h("div", h("dt", "Game menu"), h("dd", "Select + Start together, or Esc")),
        h("div", h("dt", "Quick save / load"), h("dd", "Select + R / Select + L, or F2 / F4")),
        h("div", h("dt", "Desktop emulators"), h("dd", "Esc (or the emulator's own menu) quits back to Phosphor")))));
  return () => { clearInterval(padTimer); clearInterval(padCapture); window.removeEventListener("keydown", onKey, true); };
}

// Desktop emulators: what Phosphor sets up for you, and a button to open each one's own settings
// (stored with your player, so changes apply when Phosphor starts your games).
const AUTO = {
  controls: {
    flycast: "Any controller is set up automatically.",
    dolphin: "Xbox-style controllers are set up automatically on Windows.",
    pcsx2: "Your first controller is set up as a DualShock 2.",
    cemu: "Xbox-style controllers are set up automatically on Windows.",
    rpcs3: "Xbox-style controllers are set up automatically on Windows.",
    azahar: "Any controller is set up automatically (Nintendo button positions).",
    eden: "Map your controller once here or in Eglantine (Emulation › Configure › Controls); Phosphor copies it to the other and to every player.",
    eglantine: "Map your controller once here or in Eden (Emulation › Configure › Controls); Phosphor copies it to the other and to every player.",
    xemu: "Controllers are set up automatically.", vita3k: "Controllers are set up automatically.",
    shadps4: "Controllers are set up automatically.", xenia: "Xbox controllers work automatically.",
  },
};
function desktopCard(kind) {
  if (!store.state.desktop) {
    return h("div.card", h("h3", "Desktop emulators"), h("p", "GameCube, Wii, PS2, Switch and the other big consoles run in the free Phosphor desktop app for Windows, Mac and Linux, where their controller and graphics settings live."), desktopLink());
  }
  const list = store.state.emulators?.native || [];
  return h("div.card", h("h3", "Desktop emulators"),
    h("p", kind === "controls" ? "Each desktop emulator has its own controller settings. Phosphor sets up what it can; open an emulator to change anything else." : "Settings Phosphor doesn't control can be changed in each emulator's own settings window."),
    h("div.list", list.map((n) => h("div.list-item", { style: { cursor: "default" } },
      h("div.grow", h("div.t", `${n.name}`, h("span", { style: { color: "var(--text-3)", fontWeight: 500 } }, ` · ${n.systems.map((id) => store.systems[id]?.short || id).join(", ")}`)),
        h("div.d", kind === "controls" ? AUTO.controls[n.id] || "" : n.graphics?.length ? `Phosphor sets: ${n.graphics.map((g) => ({ scale: "resolution", widescreen: "widescreen", fps: "FPS counter", vsync: "V-sync" })[g]).join(", ")}` : "Uses its own graphics settings")),
      n.configurable && n.version ? h("button.btn.small", { "data-nav": "", onclick: async () => {
        try { await api.post(`/api/native/${n.id}/configure`); toast({ title: `${n.name} is open`, text: "Change what you like, then close it to come back.", icon: "settings", timeout: 6000 }); } catch (e) { toastError(e); }
      } }, ic("settings"), `Open ${n.name} settings`) : h("span.chip", n.version ? "No settings window" : "Not installed")))));
}

// ---------------- Graphics ----------------
const SCALES = [[1, "Native"], [2, "2× · 720p"], [3, "3× · 1080p"], [4, "4× · 1440p"], [6, "6× · 4K"]];
const FILTER_CHOICES = [["sharp", "Pixel perfect"], ["smooth", "Smooth"], ["crt", "CRT"], ["crt-curved", "Curved CRT"], ["lcd", "Handheld LCD"]];

async function graphics(root) {
  const g = { scale: 2, widescreen: false, fps: false, vsync: true, ...(store.profile.settings?.graphics || {}) };
  const save = async () => { try { await saveProfileSettings({ graphics: g }); } catch (e) { toastError(e); } };
  const managed = g.mode !== "emulator";
  const scaleBtns = h("div.segmented", SCALES.map(([v, l]) => h("button", { "data-nav": "", class: g.scale === v ? "on" : "", onclick: (e) => {
    g.scale = v; save(); e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.currentTarget));
  } }, l)));
  const desktopOpts = h("div", { hidden: !managed },
    h("div.setting", h("div.grow", h("div.t", "Resolution"), h("div.d", "Higher looks sharper and needs a stronger graphics card. 2× suits most PCs; 4× and up want a gaming GPU.")), scaleBtns),
    h("div.setting", h("div.grow", h("div.t", "Widescreen"), h("div.d", "Stretch 4:3 games to fill a widescreen TV properly where the emulator can (some games show glitches at the edges).")), toggle(g.widescreen, (v) => { g.widescreen = v; save(); })),
    h("div.setting", h("div.grow", h("div.t", "Show FPS"), h("div.d", "A frame-rate counter in the corner while you play.")), toggle(g.fps, (v) => { g.fps = v; save(); })),
    h("div.setting", h("div.grow", h("div.t", "V-sync"), h("div.d", "Prevents screen tearing. Turn off if games feel laggy.")), toggle(g.vsync, (v) => { g.vsync = v; save(); })));

  const filters = { ...(store.profile.settings?.filters || {}) };
  const consoles = store.systemList.filter((s) => !s.native);
  const filterRows = h("div.list", consoles.map((s) => h("div.list-item", { style: { cursor: "default" } },
    h("span.sw", { style: { width: "10px", height: "10px", borderRadius: "3px", background: s.color, flex: "none" } }),
    h("div.grow", h("div.t", s.name)),
    h("label.field", { style: { width: "190px", height: "40px" } }, h("select", { onchange: async (e) => { filters[s.id] = e.target.value; try { await saveProfileSettings({ filters }); } catch (err) { toastError(err); } } },
      FILTER_CHOICES.map(([v, l]) => h("option", { value: v, selected: (filters[s.id] || "sharp") === v }, l)))))));
  const setAll = (v) => { for (const s of consoles) filters[s.id] = v; saveProfileSettings({ filters }).then(() => go("/settings/graphics")).catch(toastError); };

  root.append(
    store.state.desktop ? h("div.card", h("h3", "Desktop emulators"),
      h("div.setting", h("div.grow", h("div.t", "Let Phosphor set graphics"), h("div.d", "One set of choices for Dolphin, Flycast, PCSX2 and xemu. Turn off to use each emulator's own settings instead.")),
        toggle(managed, (v) => { g.mode = v ? "phosphor" : "emulator"; desktopOpts.hidden = !v; save(); })),
      desktopOpts) : null,
    desktopCard("graphics"),
    h("div.card", h("h3", "In-browser consoles"),
      h("p", "How each console's picture is drawn. You can also switch this during a game from the game menu (Display)."),
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" } },
        h("span", { style: { color: "var(--text-3)", fontSize: "13px", alignSelf: "center" } }, "Set all to:"),
        FILTER_CHOICES.map(([v, l]) => h("button.btn.small", { "data-nav": "", onclick: () => setAll(v) }, l))),
      filterRows));
}

// ---------------- Library ----------------
async function library(root) {
  const lib = store.state.library;
  const bios = await api.get("/api/bios");
  const scanBtn = h("button.btn", { "data-nav": "", onclick: async () => { await api.post("/api/library/scan"); toast({ title: "Scanning your library", icon: "refresh" }); } }, ic("refresh"), "Scan now");
  const regionSel = h("select", { onchange: async (e) => { await saveSettings({ regionOrder: e.target.value.split(",") }); } },
    [["US,World,EU,JP", "USA first"], ["EU,World,US,JP", "Europe first"], ["JP,World,US,EU", "Japan first"]].map(([v, l]) => h("option", { value: v, selected: (store.settings.regionOrder || []).join(",") === v }, l)));
  root.append(
    h("div.card", h("h3", "Folders"),
      h("p", "Drop games into the drop folder (or onto any Phosphor window) and they're sorted automatically. You can also copy straight into ROMs/<console>."),
      h("dl.kv",
        h("div", h("dt", "Library"), h("dd", lib.root)),
        h("div", h("dt", "Drop folder"), h("dd", lib.dropFolder)),
        h("div", h("dt", "Last scan"), h("dd", lib.lastScan ? `${timeAgo(Date.parse(lib.lastScan.at))} · ${plural(lib.lastScan.total, "game")}` : "Not yet"))),
      window.phosphorDesktop ? h("div", { style: { display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" } },
        h("button.btn", { "data-nav": "", onclick: () => window.phosphorDesktop.openFolder("") }, ic("folder"), "Open games folder"),
        h("button.btn", { "data-nav": "", onclick: () => window.phosphorDesktop.openFolder("Drop Games Here") }, ic("upload"), "Open drop folder"),
        h("button.btn.ghost", { "data-nav": "", onclick: async () => {
          if (!(await confirmBox("Use a different folder?", "Phosphor restarts and uses the folder you pick. Your current folder isn't moved or deleted.", { ok: "Choose folder" }))) return;
          window.phosphorDesktop.chooseLibrary();
        } }, "Change folder…")) : null,
      h("div", { style: { display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" } }, scanBtn,
        h("button.btn", { "data-nav": "", onclick: async () => { await api.post("/api/library/scan?full=1"); toast({ title: "Re-checking every game", text: "Names and box art get refreshed where better matches exist.", icon: "refresh" }); } }, ic("sparkles"), "Re-check every game"),
        h("button.btn", { "data-nav": "", onclick: () => window.phosphor.pickFiles() }, ic("upload"), "Add games")),
      lib.unknown?.length ? h("div.note", { style: { marginTop: "16px" } }, ic("alert"),
        h("div", h("b", `${plural(lib.unknown.length, "file")} in the drop folder weren't recognised`), h("div", { style: { fontSize: "13px", marginTop: "6px" } }, lib.unknown.slice(0, 12).join(", ")),
          h("div", { style: { fontSize: "13px", marginTop: "6px" } }, "Move them into the matching ROMs/<console> folder and Phosphor will pick them up."))) : null),
    h("div.card", h("h3", "Regions"),
      h("div.setting", h("div.grow", h("div.t", "Show one card per game"), h("div.d", "Hide extra regional versions (USA, Europe, Japan) and show your preferred one")), toggle(store.settings.groupRegions, (v) => saveSettings({ groupRegions: v }))),
      h("div.setting", h("div.grow", h("div.t", "Preferred region")), h("label.field", { style: { width: "200px" } }, regionSel))),
    h("div.card", h("h3", "BIOS"),
      h("p", "You don't need to find any BIOS files. Here's how each console is covered:"),
      h("div.list", store.systemList.map((s) => {
        const b = bios[s.id];
        const yours = b?.files?.filter((f) => f.found) || [];
        const [dot, label, detail] = s.needs && !b?.ready ? ["warn", s.needs.chip, s.needs.help]
          : s.needs ? ["", "Ready", yours.map((f) => f.name).join(", ")]
          : yours.length
          ? ["", "Using your BIOS", yours.map((f) => `${f.name}${f.verified ? " ✓" : ""}`).join(", ")]
          : s.bios === "included" ? ["", "Included", s.biosLabel]
            : s.bios === "builtin" ? ["", "Built in", s.biosLabel]
              : s.bios === "yours" ? ["warn", "Needs yours", `Drop ${s.biosFiles.map((f) => f.name).join(" or ")} into the BIOS folder`]
                : ["", "Not needed", "This console never had a BIOS chip, or the emulator doesn't need one"];
        return h("div.list-item", { style: { cursor: "default" } },
          h("span.status-dot", { class: dot }),
          h("div.grow", h("div.t", s.name), h("div.d", detail)),
          h("span.chip", label));
      })),
      h("p", { style: { marginTop: "14px", fontSize: "13px" } }, (store.state.hiddenSystems || []).length ? `Left out: ${store.state.hiddenSystems.map((x) => x.name).join(", ")}. These consoles can't start without their maker's copyrighted BIOS, and no free replacement exists. Add your own and the console appears. ` : "",
        "Official BIOS dumps are copyrighted, so Phosphor can't include them. If you own some, drop them anywhere (BIOS folder, drop folder, or next to your games): Phosphor checks them by checksum, files them, and uses them automatically for even better compatibility.")));
}

// ---------------- Players ----------------
async function players(root) {
  const list = h("div.list");
  const draw = () => {
    list.replaceChildren(...store.profiles.map((p) => h("div.list-item",
      h("span.avatar", { "--c": p.color, style: { width: "48px", height: "48px", fontSize: "24px" } }, p.avatar),
      h("div.grow", h("div.t", p.name), h("div.d", p.id === store.profile.id ? "Playing now on this device" : "Own saves, favorites and stats")),
      h("button.btn.small", { "data-nav": "", onclick: () => editPlayer(p, draw) }, ic("edit"), "Edit"),
      store.profiles.length > 1 ? h("button.btn.small.icon.ghost", { "data-nav": "", "aria-label": "Remove", onclick: async () => {
        if (!(await confirmBox(`Remove ${p.name}?`, "Their save files stay in the Saves folder, but their stats and save states are deleted.", { ok: "Remove", danger: true }))) return;
        await api.del(`/api/profiles/${p.id}`).catch(toastError);
        await refreshState(); draw();
      } }, ic("trash")) : null)));
  };
  draw();
  root.append(h("div.card", h("h3", "Players"), h("p", "Everyone gets their own saves, resume points, favorites and play time. Pick who's playing from the avatar in the corner."),
    list,
    h("button.btn", { "data-nav": "", style: { marginTop: "14px" }, onclick: async () => {
      const p = await api.post("/api/profiles", {});
      await refreshState();
      editPlayer(store.profiles.find((x) => x.id === p.id), draw);
    } }, ic("plus"), "Add player")));
}

function editPlayer(p, done) {
  let avatar = p.avatar, color = p.color;
  let kid = !!p.settings?.kid;
  const allowed = new Set(p.settings?.systems || []);
  const name = h("input.text", { value: p.name, maxlength: 24 });
  const avs = h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", margin: "14px 0" } });
  const cols = h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px" } });
  const draw = () => {
    avs.replaceChildren(...AVATARS.map((a) => h("button.avatar", { "data-nav": "", style: { width: "46px", height: "46px", fontSize: "22px", outline: a === avatar ? "3px solid #fff" : "" }, "--c": color, onclick: () => { avatar = a; draw(); } }, a)));
    cols.replaceChildren(...COLORS.map((c) => h("button", { "data-nav": "", "aria-label": c, style: { width: "34px", height: "34px", borderRadius: "50%", background: c, outline: c === color ? "3px solid #fff" : "", outlineOffset: "2px" }, onclick: () => { color = c; draw(); } })));
  };
  draw();
  const consoles = h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" } });
  const drawConsoles = () => consoles.replaceChildren(...store.systemList.map((sy) => h("button.chip", { "data-nav": "", class: allowed.has(sy.id) ? "on" : "", onclick: () => { allowed.has(sy.id) ? allowed.delete(sy.id) : allowed.add(sy.id); drawConsoles(); } }, sy.short)));
  drawConsoles();
  const kidBox = h("div", { style: { display: kid ? "block" : "none", marginTop: "8px" } },
    h("div.d", { style: { fontSize: "13px", color: "var(--text-2)" } }, "Consoles this player can see (none picked = all). No Settings or Stats, and switching to a grown-up player asks for the parent PIN."),
    consoles);
  const kidRow = h("div.setting", { style: { borderTop: "1px solid var(--stroke)", marginTop: "16px" } },
    h("div.grow", h("div.t", "Kid mode"), h("div.d", "A simpler, safer Phosphor for little players")),
    toggle(kid, (v) => { kid = v; kidBox.style.display = v ? "block" : "none"; }));
  sheet({
    title: "Edit player", body: h("div", name, avs, cols, kidRow, kidBox),
    actions: [{ label: "Cancel", kind: "ghost" }, { label: "Save", kind: "primary", onClick: async () => {
      if (kid && !store.settings.hasPin) toast({ title: "Tip: set a parent PIN", text: "Settings › General, so kids can't switch to your player.", icon: "lock" });
      await api.patch(`/api/profiles/${p.id}`, { name: name.value, avatar, color, settings: { kid, systems: [...allowed] } }).catch(toastError);
      await refreshState();
      const av = document.querySelector("#rail-avatar");
      if (av && store.profile.id === p.id) { av.textContent = avatar; av.style.setProperty("--c", color); }
      done();
    } }],
  });
}

// ---------------- Accounts: RetroAchievements + ScreenScraper ----------------
async function accounts(root) {
  const ra = await api.get("/api/retroachievements").catch(() => null);
  const ss = await api.get("/api/screenscraper").catch(() => ({}));
  const raUser = h("input.text", { placeholder: "RetroAchievements username", value: ra?.user || "", autocomplete: "off" });
  const raKey = h("input.text", { placeholder: "Web API key", type: "password", autocomplete: "off" });
  const raCard = h("div.card", h("h3", `RetroAchievements for ${store.profile.name}`),
    h("p", "Link your free RetroAchievements account to see every game's achievements and which ones you've earned. Your Web API key is on retroachievements.org under Settings › Keys. Each player links their own."),
    ra ? h("div.list-item", { style: { cursor: "default", marginBottom: "12px" } }, ra.avatar ? h("img", { src: ra.avatar, alt: "", style: { width: "40px", height: "40px", borderRadius: "10px" } }) : ic("star"),
      h("div.grow", h("div.t", ra.user), h("div.d", "Linked")),
      h("button.btn.small.ghost", { "data-nav": "", onclick: async () => { await api.del("/api/retroachievements"); go("/settings/accounts"); } }, "Unlink")) : null,
    h("div", { style: { display: "grid", gap: "10px", maxWidth: "460px" } }, raUser, raKey,
      h("button.btn.primary", { "data-nav": "", style: { justifySelf: "start" }, onclick: async () => {
        try { const r = await api.put("/api/retroachievements", { user: raUser.value, key: raKey.value }); toast({ title: `Linked ${r.user}`, text: r.points != null ? `${r.points.toLocaleString()} points` : "", icon: "star", kind: "good" }); go("/settings/accounts"); }
        catch (e) { toastError(e, "Couldn't link RetroAchievements"); }
      } }, ic("check"), ra ? "Update" : "Link account")),
    h("p", { style: { fontSize: "13px", marginTop: "14px" } }, "Earning achievements needs an emulator RetroAchievements has approved (like RetroArch). Phosphor's in-browser emulators aren't approved yet, so play there to unlock; your progress shows up here."));

  const f = (ph, val, type = "text") => h("input.text", { placeholder: ph, value: val || "", type, autocomplete: "off" });
  const devid = f("Developer ID"), devpw = f("Developer password", "", "password"), user = f("ScreenScraper username (optional)", ss.user), pw = f("ScreenScraper password", "", "password");
  const ssCard = h("div.card", h("h3", "Game descriptions"),
    h("p", ss.ready ? "ScreenScraper is connected: descriptions, ratings, gameplay videos and manuals are being fetched." : "Descriptions come from Wikipedia for free. Connect ScreenScraper for richer info: descriptions for far more games, ratings, gameplay videos and manuals."),
    ss.builtIn ? null : h("p", { style: { fontSize: "13px" } }, "ScreenScraper gives every app its own free developer ID (ask on the screenscraper.fr forum). Adding your free ScreenScraper account as well raises your daily limit."),
    h("div", { style: { display: "grid", gap: "10px", maxWidth: "460px" } },
      ss.builtIn ? null : devid, ss.builtIn ? null : devpw, user, pw,
      h("button.btn.primary", { "data-nav": "", style: { justifySelf: "start" }, onclick: async () => {
        const body = { user: user.value, password: pw.value };
        if (!ss.builtIn) Object.assign(body, { devid: devid.value, devpassword: devpw.value });
        try { const r = await api.put("/api/screenscraper", body); toast({ title: r.ready ? "ScreenScraper connected" : "Saved", text: r.ready ? "Fetching descriptions, ratings and videos for your library." : "", icon: "check", kind: "good" }); go("/settings/accounts"); }
        catch (e) { toastError(e, "Couldn't connect ScreenScraper"); }
      } }, ic("check"), "Save")));
  root.append(raCard, ssCard);
}

// ---------------- General ----------------
async function general(root) {
  root.append(h("div.card", h("h3", "Feel"),
    h("div.setting", h("div.grow", h("div.t", "Interface sounds"), h("div.d", "Soft clicks when you move around with a controller")), toggle(sound.enabled, (v) => { sound.set(v); saveSettings({ sounds: v }); })),
    h("div.setting", h("div.grow", h("div.t", "Reduce motion"), h("div.d", "Turn off animations and tilting cards")), toggle(store.settings.reduceMotion, (v) => { document.body.classList.toggle("reduce-motion", v); saveSettings({ reduceMotion: v }); }))),
  h("div.card", h("h3", "Screensaver"),
    h("div.setting", h("div.grow", h("div.t", "Attract mode"), h("div.d", "When nobody's touched anything for a while, show your games like an arcade cabinet")),
      h("label.field", { style: { width: "170px" } }, h("select", { onchange: (e) => saveSettings({ screensaver: Number(e.target.value) }) },
        [[0, "Off"], [2, "After 2 min"], [5, "After 5 min"], [10, "After 10 min"], [30, "After 30 min"]].map(([v, l]) => h("option", { value: v, selected: (store.settings.screensaver ?? 5) === v }, l)))))),
  h("div.card", h("h3", "Parent PIN"),
    h("p", store.settings.hasPin ? "A PIN is set. Kids need it to switch to a grown-up player." : "Set a 4-digit PIN so kids in Kid mode can't switch to grown-up players (set Kid mode in Players)."),
    h("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
      h("button.btn", { "data-nav": "", onclick: async () => {
        const current = store.settings.hasPin ? await promptBox("Current PIN", { ok: "Next" }) : "";
        if (current === null) return;
        const pin = await promptBox("New 4-digit PIN", { placeholder: "1234", ok: "Save" });
        if (!pin) return;
        try { await api.post("/api/parent/pin", { pin, current }); store.settings.hasPin = true; toast({ title: "Parent PIN saved", icon: "lock", kind: "good" }); go("/settings/general"); } catch (e) { toastError(e); }
      } }, ic("lock"), store.settings.hasPin ? "Change PIN" : "Set PIN"),
      store.settings.hasPin ? h("button.btn.ghost", { "data-nav": "", onclick: async () => {
        const current = await promptBox("Current PIN", { ok: "Remove" });
        if (current === null) return;
        try { await api.post("/api/parent/pin", { pin: null, current }); store.settings.hasPin = false; toast({ title: "PIN removed", icon: "lock" }); go("/settings/general"); } catch (e) { toastError(e); }
      } }, "Remove PIN") : null)));
}

// ---------------- About ----------------
// Desktop app: is there a newer Phosphor, and the button that gets it.
function updateRow() {
  // In a browser: where to get the desktop app instead.
  if (!updates.available()) {
    return store.state.desktop ? null : h("div.list-item", ic("download"),
      h("div.grow", h("div.t", "Desktop app"), h("div.d", "Free for Windows, Mac and Linux. Plays GameCube, Wii, PS2, PS3, Switch and the other big consoles too.")), desktopLink());
  }
  const desc = h("div.d", "");
  const btn = h("button.btn.small", { "data-nav": "" });
  const row = h("div.list-item", ic("download"), h("div.grow", h("div.t", "Updates"), desc), btn);
  const stop = watchUpdates((s) => {
    if (!row.isConnected && row.dataset.shown) return stop();
    row.dataset.shown = "1";
    const label = {
      idle: ["Phosphor checks for new versions on its own.", "Check now", updates.check],
      checking: ["Checking…", null],
      none: [`You have the newest version (${s.current}).`, "Check again", updates.check],
      available: [`Phosphor ${s.version} is out.`, s.inApp ? "Update" : "Download", updates.start],
      downloading: [`Downloading ${s.version}… ${s.percent || 0}%`, null],
      ready: [`Phosphor ${s.version} is ready. Restart to finish.`, "Restart now", updates.restart],
      error: [s.error || "The last check didn't work.", "Try again", s.version && s.version !== s.current ? updates.start : updates.check],
    }[s.state] || ["", null];
    desc.textContent = label[0];
    btn.style.display = label[1] ? "" : "none";
    btn.textContent = label[1] || "";
    btn.onclick = label[2] || null;
  });
  return row;
}

async function about(root) {
  root.append(h("div.card", h("h3", `Phosphor ${store.state.version}`),
    h("p", "Every classic, every screen, zero setup."),
    updateRow(),
    h("div.list",
      credit("EmulatorJS", "The in-browser emulator runtime. GPL-3.0.", "https://emulatorjs.org"),
      credit("libretro cores", "FCEUmm, Snes9x, Mupen64Plus-Next, mGBA, Genesis Plus GX, PCSX ReARMed, PPSSPP, FinalBurn Neo and the rest. Each under its own open-source license.", "https://www.libretro.com"),
      credit("libretro database", "Game names, years and genres from No-Intro, Redump and FBNeo data.", "https://github.com/libretro/libretro-database"),
      credit("libretro thumbnails", "Box art, title screens and screenshots.", "https://thumbnails.libretro.com"),
      h("button.list-item", { "data-nav": "", onclick: photoCredits }, ic("info"), h("div.grow", h("div.t", "Controller photos"), h("div.d", "Real photos from Wikimedia Commons, most by Evan-Amos (public domain). See who took each one."))),
      credit("Inter & Space Grotesk", "Fonts, SIL Open Font License.", "https://rsms.me/inter/"),
      credit("qrcode-generator", "QR codes for phone controllers. MIT.", "https://github.com/kazuhikoarase/qrcode-generator"))),
  h("div.card", h("h3", "About games and BIOS files"),
    h("p", "Phosphor doesn't include any commercial games or copyrighted BIOS files. Play games you own. Systems that would normally need a BIOS use the emulator's built-in open replacement instead.")));
}
async function photoCredits() {
  const list = await fetch("/img/controllers/credits.json").then((r) => r.json()).catch(() => ({}));
  sheet({ title: "Controller photos", sub: "From Wikimedia Commons, cut out of their backgrounds for Phosphor. Changed versions of CC BY-SA photos are shared under the same license.", wide: true,
    body: h("div.list", Object.entries(list).map(([id, c]) => h("a.list-item", { href: c.page, target: "_blank", rel: "noopener", "data-nav": "" },
      h("img.fg-art", { src: `/img/controllers/${id}.webp`, alt: "" }),
      h("div.grow", h("div.t", c.name || store.systems[id]?.name || id), h("div.d", `${c.artist} · ${c.license}`))))) });
}
const credit = (name, text, href) => h("a.list-item", { href, target: "_blank", rel: "noopener", "data-nav": "" }, ic("info"), h("div.grow", h("div.t", name), h("div.d", text)));

function toggle(on, change) {
  const sw = h("button.switch", { "data-nav": "", role: "switch", "aria-checked": String(!!on), class: on ? "on" : "", onclick: () => {
    on = !on; sw.classList.toggle("on", on); sw.setAttribute("aria-checked", String(on)); sound.play("move"); change(on);
  } });
  return sw;
}

async function saveSettings(patch) {
  try { store.settings = await api.patch("/api/settings", patch); } catch (e) { toastError(e); }
}
