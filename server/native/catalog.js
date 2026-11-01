// Desktop emulators: real native programs for the consoles a browser can't run (Dreamcast,
// GameCube, Wii and later PS2, PS3, Switch...). Each entry says where to download the newest build
// for each OS, which file to run inside it, and how to start a game full screen with saves kept in
// Phosphor's folder. Only the desktop app runs them; the server/browser version shows these games
// with a "Play on the desktop app" note.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeIni, appDataDir, copyIfChanged, readSfo, parseSfo } from "./files.js";
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
    launch({ game, saveDir, dataDir }) {
      const settings = [
        `window:fullscreen=yes`,
        `config:Dreamcast.VMUPath=${fcVal(saveDir)}`,
        `config:Dreamcast.SavePath=${fcVal(saveDir)}`,
        `config:FetchBoxart=no`, `config:UploadCrashLogs=no`, `config:DiscordPresence=no`,
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
    launch({ game, saveDir, platform }) {
      writeDolphinControllers(saveDir, platform);
      const cfg = {
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
    launch({ game, saveDir, dataDir, sysFiles }) {
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
    prepare({ dataDir, sysFiles }) {
      const pup = sysFiles?.firmware;
      if (!pup) return [];
      const marker = doneMarker(dataDir, "ps3-firmware", pup);
      return fs.existsSync(marker) ? [] : [{ args: ["--headless", "--installfw", pup], marker, env: xdg(dataDir), message: "Installing the PS3 system software (one time)…" }];
    },
    launch({ game, dataDir }) { return { args: ["--no-gui", "--fullscreen", game], env: xdg(dataDir) }; },
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
    launch({ game, saveDir, dataDir, platform, sysFiles }) {
      const env = platform === "linux" ? xdg(dataDir) : {};
      copyIfChanged(sysFiles?.keys, path.join(appDataDir(platform, "Cemu", { xdg: env.XDG_DATA_HOME }), "keys.txt"));
      // An existing settings file skips Cemu's first-run assistant.
      const settings = path.join(appDataDir(platform, "Cemu", { xdg: env.XDG_CONFIG_HOME, kind: "config" }), "settings.xml");
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
    // The player's own console keys go where Eden reads them.
    launch({ game, dataDir, platform, sysFiles }) {
      const env = platform === "linux" ? xdg(dataDir) : {};
      const keys = path.join(appDataDir(platform, "eden", { xdg: env.XDG_DATA_HOME }), "keys");
      copyIfChanged(sysFiles?.prodKeys, path.join(keys, "prod.keys"));
      copyIfChanged(sysFiles?.titleKeys, path.join(keys, "title.keys"));
      return { args: ["-f", "-g", game], env };
    },
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
    // Eglantine shares Eden's "eden" data folder. To keep them apart on Windows it runs in portable
    // mode (a "user" folder next to the program), linked to the player's own data folder. On Linux
    // the XDG folders already point at the player's folder.
    launch({ game, dataDir, platform, sysFiles, program }) {
      const env = platform === "linux" ? xdg(dataDir) : {};
      let base = appDataDir(platform, "eden", { xdg: env.XDG_DATA_HOME });
      if (platform === "win32" && program) {
        const own = path.join(dataDir, "user");
        fs.mkdirSync(own, { recursive: true });
        const link = path.join(path.dirname(program), "user");
        try {
          try { if (fs.realpathSync(link) !== fs.realpathSync(own)) fs.unlinkSync(link); } catch { /* no link yet */ }
          if (!fs.existsSync(link)) fs.symlinkSync(own, link, "junction");
          base = own;
        } catch { /* install folder not writable: Eglantine uses the shared folder */ }
      }
      const keys = path.join(base, "keys");
      copyIfChanged(sysFiles?.prodKeys, path.join(keys, "prod.keys"));
      copyIfChanged(sysFiles?.titleKeys, path.join(keys, "title.keys"));
      return { args: ["-f", "-g", game], env };
    },
  },

  azahar: {
    id: "azahar", name: "Azahar", systems: ["3ds"], saveFolder: "3DS", license: "GPL-2.0+", home: "https://azahar-emu.org",
    sources: {
      win32: { kind: "github", repo: "azahar-emu/azahar", asset: /^azahar-windows-msvc-[\d.]+\.zip$/i },
      darwin: { kind: "github", repo: "azahar-emu/azahar", asset: /^azahar-macos-universal-[\d.]+\.zip$/i },
      linux: { kind: "github", repo: "azahar-emu/azahar", asset: /^azahar\.AppImage$/i },
    },
    exe: { win32: /^azahar(-qt)?\.exe$/i, darwin: /^Azahar\.app$/i, linux: /\.AppImage$/i },
    launch({ game, dataDir, platform }) { return { args: ["-f", game], env: platform === "linux" ? xdg(dataDir) : {} }; },
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
    async launch({ game, saveDir, dataDir, platform, sysFiles }) {
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
        "[display.window]", "fullscreen_on_startup = true", "",
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
};

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

// ---- controllers ----
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
