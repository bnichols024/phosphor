// Desktop emulators: real native programs for the consoles a browser can't run (Dreamcast,
// GameCube, Wii and later PS2, PS3, Switch...). Each entry says where to download the newest build
// for each OS, which file to run inside it, and how to start a game full screen with saves kept in
// Phosphor's folder. Only the desktop app runs them; the server/browser version shows these games
// with a "Play on the desktop app" note.
import fs from "node:fs";
import path from "node:path";

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
};

export const NATIVE_IDS = Object.keys(NATIVE);
export const nativeFor = (systemId) => Object.values(NATIVE).find((e) => e.systems.includes(systemId)) || null;

// Newest build for one OS: { version, url, file, size }.
export async function latestRelease(emu, platform = process.platform) {
  const src = emu.sources[platform];
  if (!src) throw new Error(`${emu.name} has no build for this computer.`);
  if (src.kind === "github") {
    // A token (only set in CI builds) avoids GitHub's 60-requests-an-hour limit for anonymous calls.
    const auth = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
    const res = await fetch(`${GH()}/repos/${src.repo}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "Phosphor", ...auth } });
    if (!res.ok) throw new Error(`${emu.name}: GitHub answered ${res.status}`);
    const j = await res.json();
    const a = (j.assets || []).find((x) => src.asset.test(x.name));
    if (!a) throw new Error(`${emu.name}: no download for this computer in release ${j.tag_name}`);
    const version = src.version ? src.version(j.tag_name) : j.tag_name.replace(/^v/i, "");
    return { version, url: a.browser_download_url, file: a.name, size: a.size };
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
