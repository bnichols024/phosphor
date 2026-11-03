// Desktop emulators: real native programs for the consoles a browser can't run (Dreamcast,
// GameCube, Wii and later PS2, PS3, Switch...). Each entry says where to download the newest build
// for each OS, which file to run inside it, and how to start a game full screen with saves kept in
// Phosphor's folder. Only the desktop app runs them; the server/browser version shows these games
// with a "Play on the desktop app" note.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeIni, readIniSection, appDataDir, copyIfChanged, readSfo, parseSfo } from "./files.js";
import { listZip, readZipEntry } from "../lib/zip.js";

const BIOS_DIR = fileURLToPath(new URL("../../bios/", import.meta.url));
// Linux builds keep their data in the XDG folders; pointing those at the player's own folder keeps
// settings and saves separate per player.
const xdg = (dataDir) => {
  const env = { XDG_CONFIG_HOME: path.join(dataDir, "config"), XDG_DATA_HOME: path.join(dataDir, "data") };
  for (const d of Object.values(env)) fs.mkdirSync(d, { recursive: true }); // some emulators won't create the parent
  return env;
};
const doneMarker = (dataDir, what, file) => path.join(dataDir, `${what}-${fs.statSync(file).size}.done`);

const GH = () => process.env.PHOSPHOR_GITHUB_API || "https://api.github.com";
const DOLPHIN_FEED = () => process.env.PHOSPHOR_DOLPHIN_FEED || "https://dolphin-emu.org/update/latest/beta/";

// A config value for Flycast's -config option; quotes keep paths with ":" or spaces intact.
const fcVal = (v) => `"${String(v).replace(/"/g, "")}"`;

// RetroArch's consoles (the desktop extras) and the libretro core each one uses.
export const RA_CORES = {
  vectrex: "vecx", pokemini: "pokemini", msx: "bluemsx", atarist: "hatari", atari800: "atari800",
  intellivision: "freeintv", odyssey2: "o2em", channelf: "freechaf", fds: "fceumm", neogeocd: "neocd",
};

export const NATIVE = {
  flycast: {
    id: "flycast", name: "Flycast", systems: ["dreamcast"], saveFolder: "Dreamcast", license: "GPL-2.0", home: "https://github.com/flyinghead/flycast",
    sources: {
      win32: { kind: "github", repo: "flyinghead/flycast", asset: /^flycast-win64-.*\.zip$/i },
      darwin: { kind: "github", repo: "flyinghead/flycast", asset: /^flycast-macOS-.*\.zip$/i },
      linux: { kind: "github", repo: "flyinghead/flycast", asset: /^flycast-x86_64-.*\.AppImage$/i },
    },
    exe: { win32: /^flycast\.exe$/i, darwin: /^Flycast\.app$/i, linux: /\.AppImage$/i },
    // Started with a game, Flycast's "Exit" quits back to Phosphor. VMU saves go to the player's folder.
    graphics: ["scale", "widescreen", "fps", "vsync"],
    configure({ dataDir }) { return { args: [], env: { XDG_CONFIG_HOME: path.join(dataDir, "config"), XDG_DATA_HOME: path.join(dataDir, "data") } }; },
    launch({ game, saveDir, dataDir, graphics }) {
      const yn = (v) => (v ? "yes" : "no");
      const settings = [
        `window:fullscreen=yes`,
        `config:Dreamcast.VMUPath=${fcVal(saveDir)}`,
        `config:Dreamcast.SavePath=${fcVal(saveDir)}`,
        `config:FetchBoxart=no`, `config:UploadCrashLogs=no`, `config:DiscordPresence=no`,
        // Phosphor's graphics settings (Settings › Graphics): 480 lines per step of scale.
        ...(graphics ? [`config:rend.Resolution=${480 * graphics.scale}`, `config:rend.WideScreen=${yn(graphics.widescreen)}`, `config:rend.ShowFPS=${yn(graphics.fps)}`, `config:rend.vsync=${yn(graphics.vsync)}`] : []),
      ];
      return {
        args: [...settings.flatMap((s) => ["-config", s]), game],
        // Linux/macOS builds keep their settings and save states in the XDG folders.
        env: { XDG_CONFIG_HOME: path.join(dataDir, "config"), XDG_DATA_HOME: path.join(dataDir, "data") },
      };
    },
  },

  dolphin: {
    id: "dolphin", name: "Dolphin", systems: ["gamecube", "wii"], saveFolder: "GameCube & Wii", license: "GPL-2.0+", home: "https://dolphin-emu.org",
    sources: {
      win32: { kind: "dolphin", system: /^Windows x64/i },
      darwin: { kind: "dolphin", system: /^macOS/i },
      // Dolphin only publishes a Flatpak for Linux; this community AppImage repackages each release.
      linux: { kind: "github", repo: "pkgforge-dev/Dolphin-emu-AppImage", asset: /anylinux-x86_64\.AppImage$/i, version: (tag) => tag.split("@")[0] },
    },
    exe: { win32: /^Dolphin\.exe$/i, darwin: /^Dolphin\.app$/i, linux: /\.AppImage$/i },
    // -b exits when the game stops; -u keeps every setting and save inside the player's own folder.
    graphics: ["scale", "widescreen", "fps", "vsync"],
    configure({ saveDir, platform }) {
      writeDolphinControllers(saveDir, platform);
      return { args: ["-u", saveDir, "-C", "Dolphin.Analytics.PermissionAsked=True", "-C", "Dolphin.AutoUpdate.UpdateTrack="], env: {} };
    },
    launch({ game, saveDir, platform, graphics }) {
      writeDolphinControllers(saveDir, platform);
      const tf = (v) => (v ? "True" : "False");
      const cfg = {
        ...(graphics ? {
          "GFX.Settings.InternalResolution": String(graphics.scale), "GFX.Settings.wideScreenHack": tf(graphics.widescreen),
          "GFX.Settings.ShowFPS": tf(graphics.fps), "GFX.Hardware.VSync": tf(graphics.vsync),
        } : {}),
        "Dolphin.Display.Fullscreen": "True",
        "Dolphin.Interface.ConfirmStop": "False",
        "Dolphin.Analytics.PermissionAsked": "True",
        "Dolphin.Analytics.Enabled": "False",
        "Dolphin.AutoUpdate.UpdateTrack": "",
        "Dolphin.Interface.ShowActiveTitle": "False",
      };
      return { args: ["-b", "-u", saveDir, ...Object.entries(cfg).flatMap(([k, v]) => ["-C", `${k}=${v}`]), "-e", game], env: {} };
    },
  },

  pcsx2: {
    id: "pcsx2", name: "PCSX2", systems: ["ps2"], saveFolder: "PS2", license: "GPL-3.0+", home: "https://pcsx2.net",
    sources: {
      win32: { kind: "github", repo: "PCSX2/pcsx2", asset: /^pcsx2-v[\d.]+-windows-x64-Qt\.7z$/i },
      darwin: { kind: "github", repo: "PCSX2/pcsx2", asset: /^pcsx2-v[\d.]+-macos-Qt\.tar\.xz$/i },
      linux: { kind: "github", repo: "PCSX2/pcsx2", asset: /^pcsx2-v[\d.]+-linux-appimage-x64-Qt\.AppImage$/i },
    },
    exe: { win32: /^pcsx2-qt\.exe$/i, darwin: /^PCSX2.*\.app$/i, linux: /\.AppImage$/i },
    // Its own data folder per player: the BIOS comes from Phosphor's BIOS folder, memory cards go to
    // the player's saves, and the first-run wizard is skipped.
    graphics: ["scale", "widescreen", "fps", "vsync"],
    configure(ctx) { NATIVE.pcsx2.launch({ ...ctx, game: null }); return { args: ["-datapath", ctx.dataDir], env: {} }; },
    launch({ game, saveDir, dataDir, sysFiles, graphics }) {
      const bios = sysFiles?.bios;
      const ini = path.join(dataDir, "PCSX2", "inis", "PCSX2.ini"); // -datapath adds "PCSX2"
      // First time: a starter config (PCSX2 throws away a settings file without SettingsVersion and
      // runs its wizard) with the first controller mapped as a DualShock 2, so a pad just works.
      if (!fs.existsSync(ini)) mergeIni(ini, { InputSources: { SDL: "true", SDLControllerEnhancedMode: "true" }, Pad1: PCSX2_PAD });
      mergeIni(ini, {
        UI: { SettingsVersion: "1", SetupWizardIncomplete: "false", ConfirmShutdown: "false", StartFullscreen: "true", HideMouseCursor: "true" },
        Folders: { MemoryCards: saveDir, ...(bios ? { Bios: path.dirname(bios) } : {}) },
        ...(bios ? { Filenames: { BIOS: path.basename(bios) } } : {}),
        AutoUpdater: { CheckAtStartup: "false" },
        ...(graphics ? {
          "EmuCore/GS": { upscale_multiplier: String(graphics.scale), OsdShowFPS: String(graphics.fps), VsyncEnable: graphics.vsync ? "1" : "0" },
          EmuCore: { EnableWideScreenPatches: String(graphics.widescreen) },
        } : {}),
      });
      return { args: ["-batch", "-nogui", "-fullscreen", "-datapath", dataDir, "--", game], env: {} };
    },
  },

  rpcs3: {
    id: "rpcs3", name: "RPCS3", systems: ["ps3"], saveFolder: "PS3", license: "GPL-2.0", home: "https://rpcs3.net",
    sources: {
      win32: { kind: "github", repo: "RPCS3/rpcs3-binaries-win", asset: /_win64_msvc\.7z$/i, version: (t, j, a) => a.name.match(/rpcs3-v([\d.]+-\d+)/)?.[1] || t },
      darwin: { kind: "github", repo: "RPCS3/rpcs3-binaries-mac", asset: /_macos\.7z$/i, version: (t, j, a) => a.name.match(/rpcs3-v([\d.]+-\d+)/)?.[1] || t },
      linux: { kind: "github", repo: "RPCS3/rpcs3-binaries-linux", asset: /_linux64\.AppImage$/i, version: (t, j, a) => a.name.match(/rpcs3-v([\d.]+-\d+)/)?.[1] || t },
    },
    exe: { win32: /^rpcs3\.exe$/i, darwin: /^RPCS3\.app$/i, linux: /\.AppImage$/i },
    // Sony's free PS3 system software is installed once (headless mode installs and quits).
    prepare(ctx) {
      const { dataDir, sysFiles } = ctx;
      const pup = sysFiles?.firmware;
      if (!pup) return [];
      // On Windows the firmware lives in the per-player RPCS3 folder (rpcs3Env), so its marker does too;
      // a marker from before that folder existed must not skip the install.
      const marker = doneMarker(ctx.platform === "win32" ? path.join(dataDir, "rpcs3") : dataDir, "ps3-firmware", pup);
      return fs.existsSync(marker) ? [] : [{ args: ["--headless", "--installfw", pup], marker, env: rpcs3Env(ctx), message: "Installing the PS3 system software (one time)…" }];
    },
    configure(ctx) { return { args: [], env: rpcs3Env(ctx) }; },
    launch(ctx) { return { args: ["--no-gui", "--fullscreen", ctx.game], env: rpcs3Env(ctx) }; },
  },

  shadps4: {
    id: "shadps4", name: "shadPS4", systems: ["ps4"], saveFolder: "PS4", license: "GPL-2.0", home: "https://shadps4.net",
    sources: {
      win32: { kind: "github", repo: "shadps4-emu/shadPS4", asset: /^shadps4-win64-sdl-[\d.]+\.zip$/i },
      darwin: { kind: "github", repo: "shadps4-emu/shadPS4", asset: /^shadps4-macos-sdl-[\d.]+\.zip$/i },
      linux: { kind: "github", repo: "shadps4-emu/shadPS4", asset: /^shadps4-linux-sdl-[\d.]+\.zip$/i },
    },
    exe: { win32: /^shadps4\.exe$/i, darwin: /^shadps4$|\.app$/i, linux: /(\.AppImage|^shadps4)$/i },
    launch({ game, dataDir }) { return { args: ["-f", "true", "-g", game], env: xdg(dataDir) }; },
  },

  vita3k: {
    id: "vita3k", name: "Vita3K", systems: ["vita"], saveFolder: "PS Vita", license: "GPL-2.0", home: "https://vita3k.org",
    sources: {
      // Rolling "continuous" release: the build date is the version.
      win32: { kind: "github", repo: "Vita3K/Vita3K", asset: /^windows-latest\.zip$/i, version: (t, j) => j.published_at.slice(0, 16).replace(/[-:]/g, "").replace("T", "-") },
      darwin: { kind: "github", repo: "Vita3K/Vita3K", asset: /^macos-latest\.dmg$/i, version: (t, j) => j.published_at.slice(0, 16).replace(/[-:]/g, "").replace("T", "-") },
      linux: { kind: "github", repo: "Vita3K/Vita3K", asset: /^Vita3K-x86_64\.AppImage$/i, version: (t, j) => j.published_at.slice(0, 16).replace(/[-:]/g, "").replace("T", "-") },
    },
    exe: { win32: /^Vita3K\.exe$/i, darwin: /^Vita3K\.app$/i, linux: /\.AppImage$/i },
    prepare({ dataDir, sysFiles }) {
      const steps = [];
      for (const [what, file] of [["vita-firmware", sysFiles?.firmware], ["vita-fonts", sysFiles?.fonts]]) {
        if (!file) continue;
        const marker = doneMarker(dataDir, what, file);
        if (!fs.existsSync(marker)) steps.push({ args: ["--firmware", file], marker, env: xdg(dataDir), message: "Installing the PS Vita system software (one time)…" });
      }
      return steps;
    },
    configure({ dataDir }) { return { args: [], env: xdg(dataDir) }; },
    // A game is installed the first time it's played (Vita3K installs, then starts it), and after
    // that started by its title ID.
    async launch({ game, dataDir }) {
      const content = /eboot\.bin$/i.test(game) ? path.dirname(game) : game;
      const titleId = await vitaTitleId(content);
      const installed = path.join(dataDir, "installed.json");
      const list = (() => { try { return JSON.parse(fs.readFileSync(installed, "utf8")); } catch { return {}; } })();
      const run = titleId && list[titleId] ? ["-r", titleId] : [content];
      if (titleId && !list[titleId]) { list[titleId] = content; fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(installed, JSON.stringify(list)); }
      return { args: ["-F", ...run], env: xdg(dataDir) };
    },
  },

  cemu: {
    id: "cemu", name: "Cemu", systems: ["wiiu"], saveFolder: "Wii U", license: "MPL-2.0", home: "https://cemu.info",
    sources: {
      win32: { kind: "github", repo: "cemu-project/Cemu", asset: /windows-x64\.zip$/i },
      darwin: { kind: "github", repo: "cemu-project/Cemu", asset: /macos-.*\.dmg$/i },
      linux: { kind: "github", repo: "cemu-project/Cemu", asset: /\.AppImage$/i },
    },
    exe: { win32: /^Cemu\.exe$/i, darwin: /^Cemu\.app$/i, linux: /\.AppImage$/i },
    // keys.txt (only for encrypted dumps) goes where Cemu looks; saves live in the player's mlc folder.
    configure(ctx) { const r = NATIVE.cemu.launch({ ...ctx, game: "" }); return { args: ["-m", path.join(ctx.saveDir, "mlc01")], env: r.env }; },
    launch({ game, saveDir, dataDir, platform, sysFiles }) {
      const env = platform === "linux" ? xdg(dataDir) : {};
      copyIfChanged(sysFiles?.keys, path.join(appDataDir(platform, "Cemu", { xdg: env.XDG_DATA_HOME }), "keys.txt"));
      // An existing settings file skips Cemu's first-run assistant.
      const configDir = appDataDir(platform, "Cemu", { xdg: env.XDG_CONFIG_HOME, kind: "config" });
      writeCemuController(configDir, platform);
      const settings = path.join(configDir, "settings.xml");
      if (!fs.existsSync(settings)) {
        fs.mkdirSync(path.dirname(settings), { recursive: true });
        fs.writeFileSync(settings, '<?xml version="1.0" encoding="UTF-8"?>\n<content>\n  <check_update>false</check_update>\n  <fullscreen>true</fullscreen>\n</content>\n');
      }
      return { args: ["-f", "-g", game, "-m", path.join(saveDir, "mlc01")], env };
    },
  },

  eden: {
    id: "eden", name: "Eden", systems: ["switch"], saveFolder: "Switch", license: "GPL-3.0+", home: "https://eden-emu.dev",
    sources: {
      win32: { kind: "gitea", api: "https://git.eden-emu.dev/api/v1", repo: "eden-emu/eden", asset: /^Eden-Windows-v[\d.]+-amd64-msvc-standard\.zip$/i },
      darwin: { kind: "gitea", api: "https://git.eden-emu.dev/api/v1", repo: "eden-emu/eden", asset: /^Eden-macOS-v[\d.]+\.dmg$/i },
      linux: { kind: "gitea", api: "https://git.eden-emu.dev/api/v1", repo: "eden-emu/eden", asset: /^Eden-Linux-v[\d.]+-amd64-gcc-standard\.AppImage$/i },
    },
    exe: { win32: /^eden\.exe$/i, darwin: /^Eden\.app$/i, linux: /\.AppImage$/i },
    configure(ctx) { return { args: [], env: edenFamily(ctx).env }; },
    // The player's own folder, console keys, and a controller mapping set up once in Eden or
    // Eglantine (see edenFamily).
    launch(ctx) { return { args: ["-f", "-g", ctx.game], env: edenFamily(ctx).env }; },
  },

  eglantine: {
    id: "eglantine", name: "Eglantine", systems: ["switch2"], saveFolder: "Switch 2", license: "GPL-3.0+", home: "https://github.com/Djihads80/Eglantine",
    // Very new and experimental: every build is a numbered pre-release, so take the newest one that
    // has a download for this OS. (Beware look-alike repositories; this is the project's own.)
    sources: {
      win32: { kind: "github", repo: "Djihads80/Eglantine", list: true, asset: /^eglantine-windows-x86_64-[0-9a-f]{40}\.zip$/i },
      linux: { kind: "github", repo: "Djihads80/Eglantine", list: true, asset: /^eglantine-[0-9a-f]{40}-linux-x86_64\.AppImage$/i },
    },
    exe: { win32: /^eglantine\.exe$/i, linux: /\.AppImage$/i },
    // Eglantine shares Eden's "eden" data folder name; edenFamily() keeps them apart.
    configure(ctx) { return { args: [], env: edenFamily(ctx).env }; },
    launch(ctx) { return { args: ["-f", "-g", ctx.game], env: edenFamily(ctx).env }; },
  },

  azahar: {
    id: "azahar", name: "Azahar", systems: ["3ds"], saveFolder: "3DS", license: "GPL-2.0+", home: "https://azahar-emu.org",
    sources: {
      win32: { kind: "github", repo: "azahar-emu/azahar", asset: /^azahar-windows-msvc-[\d.]+\.zip$/i },
      darwin: { kind: "github", repo: "azahar-emu/azahar", asset: /^azahar-macos-universal-[\d.]+\.zip$/i },
      linux: { kind: "github", repo: "azahar-emu/azahar", asset: /^azahar\.AppImage$/i },
    },
    exe: { win32: /^azahar(-qt)?\.exe$/i, darwin: /^Azahar\.app$/i, linux: /\.AppImage$/i },
    configure(ctx) { return { args: [], env: azaharSetup(ctx) }; },
    launch(ctx) { return { args: ["-f", ctx.game], env: azaharSetup(ctx) }; },
  },

  xemu: {
    id: "xemu", name: "xemu", systems: ["xbox"], saveFolder: "Xbox", license: "GPL-2.0", home: "https://xemu.app",
    sources: {
      win32: { kind: "github", repo: "xemu-project/xemu", asset: /^xemu-[\d.]+-windows-x86_64\.zip$/i },
      darwin: { kind: "github", repo: "xemu-project/xemu", asset: /^xemu-[\d.]+-macos-universal\.zip$/i },
      linux: { kind: "github", repo: "xemu-project/xemu", asset: /^xemu-[\d.]+-x86_64\.AppImage$/i },
    },
    exe: { win32: /^xemu\.exe$/i, darwin: /^xemu\.app$/i, linux: /\.AppImage$/i },
    // The player's BIOS files, plus a blank copyright-free hard drive per player (saves live on it).
    graphics: ["scale", "vsync"],
    async configure(ctx) { const r = await NATIVE.xemu.launch({ ...ctx, game: "" }); return { args: r.args.slice(0, 2), env: r.env }; },
    async launch({ game, saveDir, dataDir, platform, sysFiles, graphics }) {
      const hdd = path.join(saveDir, "xbox_hdd.qcow2");
      if (!fs.existsSync(hdd)) {
        const zip = path.join(BIOS_DIR, "xbox_hdd.qcow2.zip");
        const entry = (await listZip(zip))?.find((e) => e.name.endsWith(".qcow2"));
        const data = entry && await readZipEntry(zip, entry);
        if (data) { fs.mkdirSync(saveDir, { recursive: true }); fs.writeFileSync(hdd, data); }
      }
      const q = (p) => `'${String(p).replace(/'/g, "")}'`;
      const toml = path.join(dataDir, "xemu.toml");
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(toml, [
        "[general]", "show_welcome = false", "skip_boot_anim = true", "",
        "[display.window]", "fullscreen_on_startup = true", ...(graphics ? [`vsync = ${!!graphics.vsync}`] : []), "",
        ...(graphics ? ["[display.quality]", `surface_scale = ${graphics.scale}`, ""] : []),
        "[sys.files]", `bootrom_path = ${q(sysFiles?.mcpx || "")}`, `flashrom_path = ${q(sysFiles?.flash || "")}`,
        `hdd_path = ${q(hdd)}`, `eeprom_path = ${q(path.join(saveDir, "eeprom.bin"))}`, `dvd_path = ${q(game)}`, "",
      ].join("\n"));
      return { args: ["-config_path", toml, "-dvd_path", game, "-full-screen"], env: platform === "linux" ? xdg(dataDir) : {} };
    },
  },

  xenia: {
    id: "xenia", name: "Xenia Canary", systems: ["xbox360"], saveFolder: "Xbox 360", license: "BSD-3-Clause", home: "https://xenia.jp",
    // Windows only: the Linux build is still experimental.
    sources: {
      win32: { kind: "github", repo: "xenia-canary/xenia-canary-releases", asset: /^xenia_canary_windows.*\.zip$/i },
    },
    exe: { win32: /^xenia_canary\.exe$/i },
    launch({ game }) { return { args: [game, "--fullscreen=true"], env: {} }; },
  },

  // Consoles no in-browser core covers (Vectrex, MSX, Atari ST...), one libretro core each.
  retroarch: {
    id: "retroarch", name: "RetroArch", systems: Object.keys(RA_CORES), saveFolder: "RetroArch", license: "GPL-3.0", home: "https://www.retroarch.com",
    // The program from the stable builds, each console's core from the nightly ones (stable has no
    // single-core downloads). A Mac app runs on Intel and Apple chips, so it gets both cores.
    sources: {
      win32: { kind: "buildbot", path: "windows/x86_64", file: "RetroArch.7z", cores: [{ dir: "windows/x86_64", ext: "dll", into: "cores" }] },
      darwin: { kind: "buildbot", path: "apple/osx/universal", file: "RetroArch_Metal.dmg", cores: [
        { dir: "apple/osx/arm64", ext: "dylib", into: "cores/arm64" }, { dir: "apple/osx/x86_64", ext: "dylib", into: "cores/x86_64" }] },
      linux: { kind: "buildbot", path: "linux/x86_64", file: "RetroArch.7z", cores: [{ dir: "linux/x86_64", ext: "so", into: "cores" }] },
    },
    exe: { win32: /^retroarch\.exe$/i, darwin: /^RetroArch\.app$/i, linux: /\.AppImage$/i },
    graphics: ["fps", "vsync"],
    configure(ctx) { const s = retroarchSetup({ ...ctx, system: ctx.system || "vectrex" }); return { args: ["--config", s.cfg], env: {} }; },
    launch(ctx) { const s = retroarchSetup(ctx); return { args: ["-f", "--config", s.cfg, "-L", s.core, ctx.game], env: {} }; },
  },
};

// ---- RetroArch ----
// Cores that look for their BIOS in a folder of RetroArch's system folder.
const RA_BIOS_FOLDER = { neogeocd: "neocd" };
const RA_CORE_EXT = { win32: "dll", darwin: "dylib", linux: "so" };

// The install folder (the one with manifest.json) above the program, wherever the program sits
// inside it (a subfolder on Windows and Linux, deep inside RetroArch.app on a Mac).
function installRoot(program) {
  let dir = path.dirname(program);
  for (let i = 0; i < 6 && !fs.existsSync(path.join(dir, "manifest.json")); i++) dir = path.dirname(dir);
  return fs.existsSync(path.join(dir, "manifest.json")) ? dir : path.dirname(program);
}

function copyTree(src, dest, skip = new Set(), rel = "") {
  let entries = [];
  try { entries = fs.readdirSync(path.join(src, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) copyTree(src, dest, skip, r);
    else if (!skip.has(r.toLowerCase())) copyIfChanged(path.join(src, r), path.join(dest, r));
  }
}

// `key = "value"` lines, RetroArch's config format: set these keys, keep everything else.
export function mergeRaConfig(file, values) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim()) : [];
  for (const [k, v] of Object.entries(values)) {
    const line = `${k} = "${String(v).replace(/"/g, "")}"`;
    const i = lines.findIndex((l) => l.split("=")[0].trim() === k);
    if (i >= 0) lines[i] = line; else lines.push(line);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

// Per player: a config of their own, saves in Phosphor's save folder, and a system folder with
// the free BIOS replacements (C-BIOS, EmuTOS) plus the player's own BIOS files for this console.
export function retroarchSetup({ system, dataDir, saveDir, program, platform, biosFiles, graphics }) {
  const root = installRoot(program);
  const sysDir = path.join(dataDir, "system");
  const sub = RA_BIOS_FOLDER[system] || "";
  const own = (biosFiles || []).filter((f) => f.file);
  // The player's own files win over the free ones of the same name (a real TOS over EmuTOS).
  copyTree(path.join(BIOS_DIR, "retroarch"), sysDir, new Set(own.map((f) => path.join(sub, f.name).toLowerCase())));
  for (const f of own) copyIfChanged(f.file, path.join(sysDir, sub, f.name));
  const arch = platform === "darwin" ? (process.arch === "arm64" ? "arm64" : "x86_64") : "";
  const core = path.join(root, "cores", arch, `${RA_CORES[system]}_libretro.${RA_CORE_EXT[platform]}`);
  const cfg = path.join(dataDir, "retroarch.cfg");
  mergeRaConfig(cfg, {
    system_directory: sysDir,
    savefile_directory: saveDir,
    savestate_directory: path.join(saveDir, "states"),
    screenshot_directory: path.join(saveDir, "screenshots"),
    libretro_directory: path.dirname(core),
    video_fullscreen: "true",
    input_autodetect_enable: "true",
    // Controller: L3+R3 opens RetroArch's menu, Start+Select quits back to Phosphor.
    input_menu_toggle_gamepad_combo: "2",
    input_quit_gamepad_combo: "4",
    quit_press_twice: "false",
    menu_show_online_updater: "false",
    menu_show_core_updater: "false",
    pause_nonactive: "false",
    ...(graphics ? { video_vsync: graphics.vsync ? "true" : "false", fps_show: graphics.fps ? "true" : "false" } : {}),
  });
  return { core, cfg, sysDir };
}

// PCSX2 bindings for the first SDL controller (any Xbox, PlayStation or Switch pad).
const PCSX2_PAD = Object.fromEntries(Object.entries({
  Type: "DualShock2", Up: "DPadUp", Down: "DPadDown", Left: "DPadLeft", Right: "DPadRight",
  Cross: "FaceSouth", Circle: "FaceEast", Square: "FaceWest", Triangle: "FaceNorth",
  L1: "LeftShoulder", R1: "RightShoulder", L2: "+LeftTrigger", R2: "+RightTrigger", L3: "LeftStick", R3: "RightStick",
  Start: "Start", Select: "Back", Analog: "Guide",
  LUp: "-LeftY", LDown: "+LeftY", LLeft: "-LeftX", LRight: "+LeftX", RUp: "-RightY", RDown: "+RightY", RLeft: "-RightX", RRight: "+RightX",
  LargeMotor: "LargeMotor", SmallMotor: "SmallMotor",
}).map(([k, v]) => [k, k === "Type" ? v : `SDL-0/${v}`]));

// PS Vita title ID from a .vpk (zip) or an installed-style folder.
async function vitaTitleId(content) {
  try {
    if (/\.(vpk|zip)$/i.test(content)) {
      const entry = (await listZip(content))?.find((e) => e.name.toLowerCase() === "sce_sys/param.sfo");
      return entry ? parseSfo(await readZipEntry(content, entry))?.TITLE_ID || null : null;
    }
    return (await readSfo(path.join(content, "sce_sys", "param.sfo")))?.TITLE_ID || null;
  } catch { return null; }
}

export const NATIVE_IDS = Object.keys(NATIVE);
export const nativeFor = (systemId) => Object.values(NATIVE).find((e) => e.systems.includes(systemId)) || null;

// Newest build for one OS: { version, url, file, size }.
export async function latestRelease(emu, platform = process.platform) {
  const src = emu.sources[platform];
  if (!src) throw new Error(`${emu.name} has no build for this computer.`);
  if (src.kind === "github") {
    // A token (only set in CI builds) avoids GitHub's 60-requests-an-hour limit for anonymous calls.
    const auth = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
    const headers = { accept: "application/vnd.github+json", "user-agent": "Phosphor", ...auth };
    let j;
    if (src.list) {
      // Projects that only publish pre-releases: the newest release with a build for this OS.
      const res = await fetch(`${GH()}/repos/${src.repo}/releases?per_page=15`, { headers });
      if (!res.ok) throw new Error(`${emu.name}: GitHub answered ${res.status}`);
      j = (await res.json()).find((r) => !r.draft && (r.assets || []).some((x) => src.asset.test(x.name)));
      if (!j) throw new Error(`${emu.name}: no recent build for this computer`);
    } else {
      const res = await fetch(`${GH()}/repos/${src.repo}/releases/latest`, { headers });
      if (!res.ok) throw new Error(`${emu.name}: GitHub answered ${res.status}`);
      j = await res.json();
    }
    const a = (j.assets || []).find((x) => src.asset.test(x.name));
    if (!a) throw new Error(`${emu.name}: no download for this computer in release ${j.tag_name}`);
    const version = src.version ? src.version(j.tag_name, j, a) : j.tag_name.replace(/^v\.?/i, "");
    return { version, url: a.browser_download_url, file: a.name, size: a.size };
  }
  if (src.kind === "gitea") {
    const res = await fetch(`${process.env.PHOSPHOR_GITEA_API || src.api}/repos/${src.repo}/releases/latest`, { headers: { accept: "application/json", "user-agent": "Phosphor" } });
    if (!res.ok) throw new Error(`${emu.name}: release server answered ${res.status}`);
    const j = await res.json();
    const a = (j.assets || []).find((x) => src.asset.test(x.name));
    if (!a) throw new Error(`${emu.name}: no download for this computer in release ${j.tag_name}`);
    return { version: j.tag_name.replace(/^v\.?/i, ""), url: a.browser_download_url, file: a.name, size: a.size };
  }
  if (src.kind === "buildbot") {
    // libretro's build server: the newest stable RetroArch, plus each console's core ("extras",
    // unpacked into the install's cores folder). The version is RetroArch's; cores update with it.
    const base = process.env.PHOSPHOR_BUILDBOT || "https://buildbot.libretro.com";
    const res = await fetch(`${base}/stable/`, { headers: { "user-agent": "Phosphor" } });
    if (!res.ok) throw new Error(`${emu.name}: build server answered ${res.status}`);
    const versions = [...(await res.text()).matchAll(/href="\/stable\/(\d+\.\d+\.\d+)\/"/g)].map((m) => m[1]);
    const num = (v) => v.split(".").map(Number);
    const version = versions.sort((a, b) => { const [x, y] = [num(a), num(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }).at(-1);
    if (!version) throw new Error(`${emu.name}: no stable release found`);
    const extras = src.cores.flatMap((c) => [...new Set(Object.values(RA_CORES))].map((core) => ({
      url: `${base}/nightly/${c.dir}/latest/${core}_libretro.${c.ext}.zip`, file: `${core}_libretro.${c.ext}.zip`, into: c.into,
    })));
    return { version, url: `${base}/stable/${version}/${src.path}/${src.file}`, file: src.file, size: 0, extras };
  }
  if (src.kind === "dolphin") {
    const res = await fetch(DOLPHIN_FEED(), { headers: { accept: "application/json", "user-agent": "Phosphor" } });
    if (!res.ok) throw new Error(`Dolphin: update server answered ${res.status}`);
    const j = await res.json();
    const a = (j.artifacts || []).find((x) => src.system.test(x.system));
    if (!a) throw new Error("Dolphin: no download for this computer");
    return { version: j.shortrev, url: a.url, file: a.url.split("/").pop(), size: 0 };
  }
  throw new Error(`unknown source ${src.kind}`);
}

// ---- per-player folders on Windows ----
// Eden, Eglantine and Azahar switch to "portable" mode when a "user" folder sits next to the
// program. Phosphor makes that folder a link to the player's own folder, so each player (and each
// emulator) has separate settings and saves. If the install folder isn't writable, the emulator
// falls back to its normal shared folder. `seedFrom`: the shared folder this emulator used before
// Phosphor gave it a per-player one; a new player folder starts as a copy, so settings, saves and
// installed content carry over.
function portableUser(program, dataDir, seedFrom = null) {
  if (!program) return null;
  const own = path.join(dataDir, "user");
  const fresh = !fs.existsSync(own);
  fs.mkdirSync(own, { recursive: true });
  if (fresh && seedFrom && fs.existsSync(seedFrom)) {
    try { fs.cpSync(seedFrom, own, { recursive: true, errorOnExist: false }); } catch { /* start empty */ }
  }
  const link = path.join(path.dirname(program), "user");
  try {
    try { if (fs.realpathSync(link) !== fs.realpathSync(own)) fs.unlinkSync(link); } catch { /* no link yet */ }
    if (!fs.existsSync(link)) fs.symlinkSync(own, link, "junction");
    return own;
  } catch { return null; }
}

// ---- Eden and Eglantine (Switch, Switch 2) ----
// Their controller mappings name the exact controller (SDL GUID), which depends on the model and
// Windows driver, so nothing can be written in advance. Instead: map it once in either emulator,
// and Phosphor copies that mapping to the other one and to every other player.
const edenConfigs = (dataDir) => {
  const root = path.dirname(path.dirname(dataDir)); // <library>/.phosphor/native-data
  const out = [];
  for (const emu of ["eden", "eglantine"]) {
    let players = [];
    try { players = fs.readdirSync(path.join(root, emu)); } catch { continue; }
    for (const p of players) {
      for (const f of [path.join(root, emu, p, "user", "config", "qt-config.ini"), path.join(root, emu, p, "config", "eden", "qt-config.ini")]) {
        if (fs.existsSync(f)) out.push(f);
      }
    }
  }
  return out;
};
const hasPadMapping = (controls) => /engine:sdl/.test(controls?.player_0_button_a || "");

export function edenFamily({ dataDir, platform, sysFiles, program }) {
  const env = platform === "linux" ? xdg(dataDir) : {};
  let base = appDataDir(platform, "eden", { xdg: env.XDG_DATA_HOME });
  let config = platform === "linux" ? path.join(env.XDG_CONFIG_HOME, "eden") : path.join(base, "config");
  if (platform === "win32") {
    // Eden used %APPDATA%\eden before; Eglantine was already portable (its own folder from the start).
    const isEden = path.basename(path.dirname(dataDir)) === "eden";
    const own = portableUser(program, dataDir, isEden && process.env.APPDATA ? path.join(process.env.APPDATA, "eden") : null);
    if (own) { base = own; config = path.join(own, "config"); }
  }
  copyIfChanged(sysFiles?.prodKeys, path.join(base, "keys", "prod.keys"));
  copyIfChanged(sysFiles?.titleKeys, path.join(base, "keys", "title.keys"));
  const ini = path.join(config, "qt-config.ini");
  if (!hasPadMapping(readIniSection(ini, "Controls"))) {
    // Newest mapping set up anywhere else wins.
    const source = edenConfigs(dataDir).filter((f) => f !== ini && hasPadMapping(readIniSection(f, "Controls")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    if (source) {
      const keys = Object.fromEntries(Object.entries(readIniSection(source, "Controls")).filter(([k]) => k.startsWith("player_0_")));
      mergeIni(ini, { Controls: keys }, { sep: "=" });
    }
  }
  return { env, base, config };
}

// ---- Azahar (3DS) ----
// Azahar can map "any controller" by standard gamepad buttons, so a mapping can be written in
// advance: Nintendo layout by position (3DS A is the right button = Xbox B). Only when the player
// hasn't mapped a controller themselves.
const AZ_BUTTONS = { button_a: 1, button_b: 0, button_x: 3, button_y: 2, button_up: 11, button_down: 12, button_left: 13, button_right: 14,
  button_l: 9, button_r: 10, button_start: 6, button_select: 4, button_home: 5 };
function azaharSetup({ dataDir, platform, program }) {
  const env = platform === "linux" ? xdg(dataDir) : {};
  let config = null;
  if (platform === "win32") {
    const shared = path.join(process.env.APPDATA || "", "Azahar");
    const own = portableUser(program, dataDir, process.env.APPDATA ? shared : null);
    config = path.join(own || shared, "config");
  } else if (platform === "linux") config = path.join(env.XDG_CONFIG_HOME, "azahar-emu");
  if (!config) return env;
  const ini = path.join(config, "qt-config.ini");
  // Written once per player: after that, whatever the player maps (keyboard included) is kept.
  const written = path.join(dataDir, "azahar-pad.done");
  const current = (readIniSection(ini, "Controls") || {})["profiles\\1\\button_a"] || "";
  if (!fs.existsSync(written) && !/engine:sdl/.test(current)) {
    const pad = (rest) => `"engine:sdl,api:controller,maptype:all,${rest}"`;
    const keys = { profile: "0", "profiles\\size": "1", "profiles\\1\\name": "Default", "profiles\\1\\input_maptype": "0" };
    for (const [k, b] of Object.entries(AZ_BUTTONS)) keys[`profiles\\1\\${k}`] = pad(`button:${b}`);
    keys["profiles\\1\\button_zl"] = pad("axis:4,direction:+,threshold:0.5");
    keys["profiles\\1\\button_zr"] = pad("axis:5,direction:+,threshold:0.5");
    keys["profiles\\1\\circle_pad"] = pad("axis_x:0,axis_y:1,deadzone:0.1");
    keys["profiles\\1\\c_stick"] = pad("axis_x:2,axis_y:3,deadzone:0.1");
    // Azahar ignores a value whose "\default" flag is true (Qt writes one beside every setting).
    for (const k of Object.keys(keys)) if (k.startsWith("profiles\\1\\") && k !== "profiles\\1\\name") keys[`${k}\\default`] = "false";
    mergeIni(ini, { Controls: keys }, { sep: "=" });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(written, new Date().toISOString());
  }
  return env;
}

// ---- RPCS3 (PS3) ----
// Its own folder per player (RPCS3_CONFIG_DIR on Windows, XDG elsewhere), and on Windows the first
// Xbox-style controller as player 1 ("XInput Pad #1"); RPCS3 fills in its default XInput layout.
function rpcs3Env({ dataDir, platform }) {
  if (platform !== "win32") return xdg(dataDir);
  const dir = path.join(dataDir, "rpcs3");
  const input = path.join(dir, "config", "input_configs", "global", "Default.yml");
  if (!fs.existsSync(input)) {
    fs.mkdirSync(path.dirname(input), { recursive: true });
    fs.writeFileSync(input, "Player 1 Input:\n  Handler: XInput\n  Device: XInput Pad #1\n");
  }
  return { RPCS3_CONFIG_DIR: `${dir.replace(/\\/g, "/")}/` }; // must end with a slash
}

// ---- controllers ----
// Cemu: the Wii U GamePad on the first Xbox-style controller (XInput "0"), using Cemu's own
// default XInput layout, so a plugged-in pad just works. Written only when the player hasn't set
// up a controller in Cemu themselves.
function writeCemuController(configDir, platform) {
  if (platform !== "win32") return;
  const file = path.join(configDir, "controllerProfiles", "controller0.xml");
  try { if (/<controller>/.test(fs.readFileSync(file, "utf8"))) return; } catch { /* not there yet */ }
  // Wii U button id -> Cemu XInput input (bits of wButtons, then trigger/stick directions).
  const map = [[1, 13], [2, 12], [3, 15], [4, 14], [5, 8], [6, 9], [7, 42], [8, 43], [9, 4], [10, 5], [11, 0], [12, 1], [13, 2], [14, 3],
    [15, 6], [16, 7], [17, 39], [18, 45], [19, 44], [20, 38], [21, 41], [22, 47], [23, 46], [24, 40]];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<emulated_controller>
\t<type>Wii U GamePad</type>
\t<controller>
\t\t<api>XInput</api>
\t\t<uuid>0</uuid>
\t\t<display_name>Controller 1</display_name>
\t\t<rumble>0.5</rumble>
\t\t<axis><deadzone>0.25</deadzone><range>1</range></axis>
\t\t<rotation><deadzone>0.25</deadzone><range>1</range></rotation>
\t\t<trigger><deadzone>0.25</deadzone><range>1</range></trigger>
\t\t<mappings>
${map.map(([m, b]) => `\t\t\t<entry><mapping>${m}</mapping><button>${b}</button></entry>`).join("\n")}
\t\t</mappings>
\t</controller>
</emulated_controller>
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, xml);
}

// Dolphin needs a mapping to know which buttons do what. On Windows every Xbox-style pad is
// "XInput/0/Gamepad", so a plugged-in controller just works. Positional layout: the GameCube's big
// A is the bottom face button, B the left one. Only written once; the player's own changes stay.
function writeDolphinControllers(userDir, platform) {
  if (platform !== "win32") return;
  const dir = path.join(userDir, "Config");
  const ini = (file, body) => { const f = path.join(dir, file); if (!fs.existsSync(f)) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, body); } };
  const dev = "XInput/0/Gamepad";
  ini("GCPadNew.ini", `[GCPad1]
Device = ${dev}
Buttons/A = \`Button A\`
Buttons/B = \`Button X\`
Buttons/X = \`Button B\`
Buttons/Y = \`Button Y\`
Buttons/Z = \`Shoulder R\`
Buttons/Start = Start
Main Stick/Up = \`Left Y+\`
Main Stick/Down = \`Left Y-\`
Main Stick/Left = \`Left X-\`
Main Stick/Right = \`Left X+\`
C-Stick/Up = \`Right Y+\`
C-Stick/Down = \`Right Y-\`
C-Stick/Left = \`Right X-\`
C-Stick/Right = \`Right X+\`
Triggers/L = \`Trigger L\`
Triggers/R = \`Trigger R\`
Triggers/L-Analog = \`Trigger L\`
Triggers/R-Analog = \`Trigger R\`
D-Pad/Up = \`Pad N\`
D-Pad/Down = \`Pad S\`
D-Pad/Left = \`Pad W\`
D-Pad/Right = \`Pad E\`
Rumble/Motor = \`Motor L\`|\`Motor R\`
`);
  // Wii Remote + Nunchuk on one pad: stick moves, right stick points, triggers are B and Z.
  ini("WiimoteNew.ini", `[Wiimote1]
Device = ${dev}
Source = 1
Extension = Nunchuk
Buttons/A = \`Button A\`
Buttons/B = \`Trigger R\`
Buttons/1 = \`Button X\`
Buttons/2 = \`Button Y\`
Buttons/- = Back
Buttons/+ = Start
Buttons/Home = Guide
D-Pad/Up = \`Pad N\`
D-Pad/Down = \`Pad S\`
D-Pad/Left = \`Pad W\`
D-Pad/Right = \`Pad E\`
IR/Up = \`Right Y+\`
IR/Down = \`Right Y-\`
IR/Left = \`Right X-\`
IR/Right = \`Right X+\`
Shake/X = \`Shoulder R\`
Shake/Y = \`Shoulder R\`
Shake/Z = \`Shoulder R\`
Rumble/Motor = \`Motor L\`|\`Motor R\`
Nunchuk/Buttons/C = \`Shoulder L\`
Nunchuk/Buttons/Z = \`Trigger L\`
Nunchuk/Stick/Up = \`Left Y+\`
Nunchuk/Stick/Down = \`Left Y-\`
Nunchuk/Stick/Left = \`Left X-\`
Nunchuk/Stick/Right = \`Left X+\`
Classic/Buttons/a = \`Button B\`
Classic/Buttons/b = \`Button A\`
Classic/Buttons/x = \`Button Y\`
Classic/Buttons/y = \`Button X\`
Classic/Buttons/ZL = \`Shoulder L\`
Classic/Buttons/ZR = \`Shoulder R\`
Classic/Buttons/- = Back
Classic/Buttons/+ = Start
Classic/Buttons/Home = Guide
Classic/Left Stick/Up = \`Left Y+\`
Classic/Left Stick/Down = \`Left Y-\`
Classic/Left Stick/Left = \`Left X-\`
Classic/Left Stick/Right = \`Left X+\`
Classic/Right Stick/Up = \`Right Y+\`
Classic/Right Stick/Down = \`Right Y-\`
Classic/Right Stick/Left = \`Right X-\`
Classic/Right Stick/Right = \`Right X+\`
Classic/Triggers/L = \`Trigger L\`
Classic/Triggers/R = \`Trigger R\`
Classic/D-Pad/Up = \`Pad N\`
Classic/D-Pad/Down = \`Pad S\`
Classic/D-Pad/Left = \`Pad W\`
Classic/D-Pad/Right = \`Pad E\`
`);
}
