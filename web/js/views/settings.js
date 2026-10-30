import { api } from "../api.js";
import { store, go, refreshState } from "../store.js";
import { h, ic, toast, toastError, sheet, confirmBox, promptBox, timeAgo, plural } from "../ui.js";
import { sound } from "../sound.js";

const SECTIONS = [
  ["emulators", "Emulators", "cpu"],
  ["library", "Library & BIOS", "folder"],
  ["players", "Players", "users"],
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
  const render = { emulators, library, players, general, about }[section];
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
      if (s.phase !== "done") changes.replaceChildren();
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
      table();
    }
    paint(s);
  };
  window.addEventListener("phosphor:emulators", onProgress);

  const tableHost = h("div");
  const table = () => {
    const cores = summary.active?.cores || {};
    tableHost.replaceChildren(h("table.core-table", h("tbody", store.systemList.map((s) => h("tr",
      h("td", h("span.sw", { "--c": s.color }), s.name),
      h("td", { style: { color: "var(--text-2)" } }, coreName(s)),
      h("td", cores[coreOf(s)] ? `v${cores[coreOf(s)]}` : "—"))))));
  };
  table();

  root.append(hero,
    h("div.card", h("h3", "What's installed"), h("p", "Every console's emulator ships with Phosphor and works offline. Update pulls the newest versions of all of them at once from the EmulatorJS project."), tableHost));

  if (!summary.state.running) {
    api.post("/api/emulators/check").then((check) => { summary = { ...summary, state: { ...summary.state, check, lastCheck: check.checkedAt } }; paint(); }).catch(() => {});
  }
  return () => window.removeEventListener("phosphor:emulators", onProgress);
}

const CORE_NAMES = { fceumm: "FCEUmm", snes9x: "Snes9x", mupen64plus_next: "Mupen64Plus-Next", gambatte: "Gambatte", mgba: "mGBA", desmume2015: "DeSmuME", melonds: "melonDS", beetle_vb: "Beetle VB", genesis_plus_gx: "Genesis Plus GX", picodrive: "PicoDrive", yabause: "Yabause", pcsx_rearmed: "PCSX ReARMed", ppsspp: "PPSSPP", stella2014: "Stella", a5200: "a5200", prosystem: "ProSystem", virtualjaguar: "Virtual Jaguar", handy: "Handy", mednafen_pce: "Beetle PCE", mednafen_ngp: "Beetle NeoPop", mednafen_wswan: "Beetle Cygne", gearcoleco: "Gearcoleco", opera: "Opera", fbneo: "FinalBurn Neo", vice_x64sc: "VICE", puae: "PUAE", dosbox_pure: "DOSBox Pure", fuse: "Fuse", cap32: "Caprice32" };
const coreOf = (s) => ({ nes: "fceumm", snes: "snes9x", n64: "mupen64plus_next", gb: "gambatte", gbc: "gambatte", gba: "mgba", nds: "desmume2015", vb: "beetle_vb", sms: "genesis_plus_gx", genesis: "genesis_plus_gx", gamegear: "genesis_plus_gx", sg1000: "genesis_plus_gx", "32x": "picodrive", saturn: "yabause", segacd: "genesis_plus_gx", psx: "pcsx_rearmed", psp: "ppsspp", atari2600: "stella2014", atari5200: "a5200", atari7800: "prosystem", jaguar: "virtualjaguar", lynx: "handy", pce: "mednafen_pce", pcecd: "mednafen_pce", ngp: "mednafen_ngp", wonderswan: "mednafen_wswan", coleco: "gearcoleco", "3do": "opera", arcade: "fbneo", c64: "vice_x64sc", amiga: "puae", dos: "dosbox_pure", zxspectrum: "fuse", cpc: "cap32" }[s.id]);
const coreName = (s) => CORE_NAMES[coreOf(s)] || coreOf(s);

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
        const [dot, label, detail] = yours.length
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
      } }, "Remove PIN") : null)),
  h("div.card", h("h3", "Controllers"),
    h("p", "Plug in or pair any controller and it just works, in the menus and in games. Your phone can be a controller too: start a game and press the phone button."),
    h("div.kv",
      h("div", h("dt", "In menus"), h("dd", "A select · B back · X favorite · Y search · LB/RB sections")),
      h("div", h("dt", "In games"), h("dd", "Press Select + Start together (or Esc) for the game menu")),
      h("div", h("dt", "Keyboard"), h("dd", "Arrows move · Z/X are B/A · Enter is Start · Esc is the menu")))));
}

// ---------------- About ----------------
async function about(root) {
  root.append(h("div.card", h("h3", `Phosphor ${store.state.version}`),
    h("p", "Every classic, every screen, zero setup."),
    h("div.list",
      credit("EmulatorJS", "The in-browser emulator runtime. GPL-3.0.", "https://emulatorjs.org"),
      credit("libretro cores", "FCEUmm, Snes9x, Mupen64Plus-Next, mGBA, Genesis Plus GX, PCSX ReARMed, PPSSPP, FinalBurn Neo and the rest. Each under its own open-source license.", "https://www.libretro.com"),
      credit("libretro database", "Game names, years and genres from No-Intro, Redump and FBNeo data.", "https://github.com/libretro/libretro-database"),
      credit("libretro thumbnails", "Box art, title screens and screenshots.", "https://thumbnails.libretro.com"),
      credit("Inter & Space Grotesk", "Fonts, SIL Open Font License.", "https://rsms.me/inter/"),
      credit("qrcode-generator", "QR codes for phone controllers. MIT.", "https://github.com/kazuhikoarase/qrcode-generator"))),
  h("div.card", h("h3", "About games and BIOS files"),
    h("p", "Phosphor doesn't include any commercial games or copyrighted BIOS files. Play games you own. Systems that would normally need a BIOS use the emulator's built-in open replacement instead.")));
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
