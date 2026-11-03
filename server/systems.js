// The system catalog: every console Phosphor knows, which emulator core runs it, which folder its
// games live in, and how to recognise its files. Everything else (scanner, UI, updater) reads this.
//
// status: "great" runs full speed on most devices; "good" needs a decent phone/PC;
// "experimental" works for many games but not all.
// bios: systems marked bios.required only appear once the user drops their own BIOS dump into the
// BIOS folder. Phosphor never ships copyrighted BIOS files; every other system uses an emulator with
// a built-in open replacement (HLE BIOS), so it needs no BIOS at all.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { NATIVE } from "./native/catalog.js";

// Real photos of each console's controller (or the device, for handhelds and computers), made by
// tools/fetch-controller-photos.mjs. Cache-busted by file time so a new photo shows up at once.
const PHOTO_DIR = fileURLToPath(new URL("../web/img/controllers/", import.meta.url));
const photoUrl = (id) => {
  try { return `/img/controllers/${id}.webp?v=${Math.round(fs.statSync(`${PHOTO_DIR}${id}.webp`).mtimeMs / 1000).toString(36)}`; } catch { return null; }
};

const NOINTRO = (n) => `metadat/no-intro/${n}.dat`;
const REDUMP = (n) => `metadat/redump/${n}.dat`;

export const SYSTEMS = [
  // ---- Nintendo ----
  {
    id: "nes", name: "Nintendo Entertainment System", short: "NES", maker: "Nintendo", year: 1985, kind: "console",
    folder: "NES", aliases: ["nes", "famicom", "fc", "nintendo"],
    exts: ["nes", "unf", "unif"], core: "fceumm", cores: ["fceumm", "nestopia"],
    dats: [NOINTRO("Nintendo - Nintendo Entertainment System"), "metadat/homebrew/Nintendo - Nintendo Entertainment System.dat"],
    meta: "Nintendo - Nintendo Entertainment System", thumbs: ["Nintendo - Nintendo Entertainment System"],
    color: "#e63946", icon: "pad-nes", pad: "nes", headerSkip: 16, status: "great", box: 0.72,
  },
  {
    id: "snes", name: "Super Nintendo", short: "SNES", maker: "Nintendo", year: 1991, kind: "console",
    folder: "SNES", aliases: ["snes", "sfc", "superfamicom", "super nintendo", "supernintendo"],
    exts: ["sfc", "smc", "fig", "swc", "bs"], core: "snes9x", cores: ["snes9x"],
    dats: [NOINTRO("Nintendo - Super Nintendo Entertainment System"), "metadat/homebrew/Nintendo - Super Nintendo Entertainment System.dat"],
    meta: "Nintendo - Super Nintendo Entertainment System", thumbs: ["Nintendo - Super Nintendo Entertainment System"],
    color: "#8b5cf6", icon: "pad-snes", pad: "snes", status: "great", box: 1.38,
  },
  {
    id: "n64", name: "Nintendo 64", short: "N64", maker: "Nintendo", year: 1996, kind: "console",
    folder: "Nintendo 64", aliases: ["n64", "nintendo64"],
    exts: ["n64", "z64", "v64"], core: "mupen64plus_next", cores: ["mupen64plus_next", "parallel_n64"],
    dats: [NOINTRO("Nintendo - Nintendo 64")],
    meta: "Nintendo - Nintendo 64", thumbs: ["Nintendo - Nintendo 64"],
    color: "#22c55e", icon: "pad-n64", pad: "n64", status: "good", box: 1.38,
  },
  {
    id: "gb", name: "Game Boy", short: "Game Boy", maker: "Nintendo", year: 1989, kind: "handheld",
    folder: "Game Boy", aliases: ["gb", "gameboy"],
    exts: ["gb"], core: "gambatte", cores: ["gambatte"],
    dats: [NOINTRO("Nintendo - Game Boy"), "metadat/homebrew/Nintendo - Game Boy.dat"],
    meta: "Nintendo - Game Boy", thumbs: ["Nintendo - Game Boy"],
    color: "#9bbc0f", icon: "gb", pad: "gb", status: "great", box: 1,
  },
  {
    id: "gbc", name: "Game Boy Color", short: "GB Color", maker: "Nintendo", year: 1998, kind: "handheld",
    folder: "Game Boy Color", aliases: ["gbc", "gameboycolor", "gameboy color"],
    exts: ["gbc"], core: "gambatte", cores: ["gambatte"],
    dats: [NOINTRO("Nintendo - Game Boy Color")],
    meta: "Nintendo - Game Boy Color", thumbs: ["Nintendo - Game Boy Color"],
    color: "#c026d3", icon: "gb", pad: "gb", status: "great", box: 1,
  },
  {
    id: "gba", name: "Game Boy Advance", short: "GBA", maker: "Nintendo", year: 2001, kind: "handheld",
    folder: "Game Boy Advance", aliases: ["gba", "gameboyadvance", "gameboy advance"],
    exts: ["gba", "agb"], core: "mgba", cores: ["mgba"],
    dats: [NOINTRO("Nintendo - Game Boy Advance"), "metadat/homebrew/Nintendo - Game Boy Advance.dat"],
    meta: "Nintendo - Game Boy Advance", thumbs: ["Nintendo - Game Boy Advance"],
    color: "#6366f1", icon: "gba", pad: "gba", status: "great", box: 1,
    includedBios: [{ name: "gba_bios.bin", file: "gba_bios.bin", label: "Cult-of-GBA open-source BIOS (MIT)" }],
    bios: { required: false, files: [{ name: "gba_bios.bin", md5: "a860e8c0b6d573d191e4ec7db1b1e4f6", label: "Official GBA BIOS" }] },
  },
  {
    id: "nds", name: "Nintendo DS", short: "DS", maker: "Nintendo", year: 2004, kind: "handheld",
    folder: "Nintendo DS", aliases: ["nds", "ds", "nintendods"],
    exts: ["nds"], core: "desmume2015", cores: ["desmume2015", "melonds", "desmume"],
    dats: [NOINTRO("Nintendo - Nintendo DS")],
    meta: "Nintendo - Nintendo DS", thumbs: ["Nintendo - Nintendo DS"],
    color: "#38bdf8", icon: "nds", pad: "nds", status: "good", box: 0.9,
    builtinBios: "DeSmuME's built-in BIOS",
    bios: { required: false, files: [
      { name: "bios7.bin", md5: "df692a80a5b1bc90728bc3dfc76cd948", label: "DS ARM7 BIOS" },
      { name: "bios9.bin", md5: "a392174eb3e572fed6447e956bde4b25", label: "DS ARM9 BIOS" },
    ] },
  },
  {
    id: "3ds", name: "Nintendo 3DS", short: "3DS", maker: "Nintendo", year: 2011, kind: "handheld",
    folder: "3DS", aliases: ["3ds", "n3ds", "nintendo3ds"],
    exts: ["3ds", "cci", "cxi", "cia", "3dsx"], discExts: [], core: null, cores: [], native: "azahar",
    dats: [NOINTRO("Nintendo - Nintendo 3DS"), NOINTRO("Nintendo - Nintendo 3DS (Digital)")],
    meta: "Nintendo - Nintendo 3DS", thumbs: ["Nintendo - Nintendo 3DS", "Nintendo - Nintendo 3DS Digital"],
    color: "#ef4444", icon: "nds", pad: "nds", status: "great", box: 0.9,
    note: "Use decrypted games (.3ds, .cci, .cxi, .cia) and homebrew (.3dsx).",
  },
  {
    id: "vb", name: "Virtual Boy", short: "Virtual Boy", maker: "Nintendo", year: 1995, kind: "console",
    folder: "Virtual Boy", aliases: ["vb", "virtualboy"],
    exts: ["vb", "vboy"], core: "beetle_vb", cores: ["beetle_vb"],
    dats: [NOINTRO("Nintendo - Virtual Boy")],
    meta: "Nintendo - Virtual Boy", thumbs: ["Nintendo - Virtual Boy"],
    color: "#ef4444", icon: "vb", pad: "vb", status: "great", box: 0.72,
  },
  {
    id: "gamecube", name: "Nintendo GameCube", short: "GameCube", maker: "Nintendo", year: 2001, kind: "console",
    folder: "GameCube", aliases: ["gamecube", "gc", "ngc", "nintendogamecube"],
    exts: ["gcm", "dol"], discExts: ["iso", "rvz", "gcz", "wia", "ciso"], core: null, cores: [], native: "dolphin",
    dats: [REDUMP("Nintendo - GameCube")], disc: true,
    meta: "Nintendo - GameCube", thumbs: ["Nintendo - GameCube"],
    color: "#7c3aed", icon: "disc", pad: "snes", status: "great", box: 0.71,
    builtinBios: "GameCube BIOS replacement built into Dolphin",
  },
  {
    id: "wii", name: "Nintendo Wii", short: "Wii", maker: "Nintendo", year: 2006, kind: "console",
    folder: "Wii", aliases: ["wii", "nintendowii"],
    exts: ["wbfs"], discExts: ["iso", "rvz", "gcz", "wia", "wad"], core: null, cores: [], native: "dolphin",
    dats: [REDUMP("Nintendo - Wii")], disc: true,
    meta: "Nintendo - Wii", thumbs: ["Nintendo - Wii"],
    color: "#94a3b8", icon: "disc", pad: "snes", status: "great", box: 0.71,
    builtinBios: "Wii system software replacement built into Dolphin",
  },
  {
    id: "wiiu", name: "Nintendo Wii U", short: "Wii U", maker: "Nintendo", year: 2012, kind: "console",
    folder: "Wii U", aliases: ["wiiu", "nintendowiiu"],
    exts: ["wud", "wux", "wua", "wuhb", "rpx"], discExts: [], core: null, cores: [], native: "cemu", folderGames: true,
    dats: [NOINTRO("Nintendo - Wii U (Digital)")], meta: null, thumbs: ["Nintendo - Wii U"],
    color: "#0891b2", icon: "disc", pad: "snes", status: "great", box: 0.71,
    note: "Decrypted games (.wua, or a folder with code, content and meta) just work. Encrypted .wud/.wux dumps also need keys.txt in the BIOS folder.",
  },
  {
    id: "switch", name: "Nintendo Switch", short: "Switch", maker: "Nintendo", year: 2017, kind: "console",
    folder: "Switch", aliases: ["switch", "nintendoswitch", "nx"],
    exts: ["nsp", "xci", "nsz", "xcz", "nro"], discExts: [], core: null, cores: [], native: "eden",
    dats: [], meta: null, thumbs: [],
    color: "#e60012", icon: "handheld-wide", pad: "snes", status: "good", box: 0.62,
    needs: { files: "switch", chip: "Needs keys", label: "your Switch keys", help: "Switch games need the keys from your own Switch (prod.keys, and title.keys if you have it). Drop them into the BIOS folder or onto this window." },
    note: "Some games also need the Switch firmware installed in Eden.",
  },
  {
    id: "switch2", name: "Nintendo Switch 2", short: "Switch 2", maker: "Nintendo", year: 2025, kind: "console",
    folder: "Switch 2", aliases: ["switch2", "ns2", "nx2", "nintendoswitch2"],
    exts: ["nsp", "xci", "nsz", "xcz", "nup"], discExts: [], core: null, cores: [], native: "eglantine", folderGames: true,
    dats: [], meta: null, thumbs: [],
    color: "#ff4554", icon: "handheld-wide", pad: "snes", status: "experimental", box: 0.62,
    note: "Switch 2 emulation is brand new: Eglantine runs a few games (Mario Kart World among them) and many not at all yet. Use games dumped from your own console: .nsp, .xci, .nup (Eglantine's own format) or unpacked folders with exefs/main inside, zipped or not. A Switch 2 .xci needs its program ID in the file name, like [0400…], to be told from a Switch game. Without keys from your console, Eglantine asks for them when it starts: choose No and the game still loads. Windows and Linux only for now.",
  },
  // ---- Sega ----
  {
    id: "sms", name: "Sega Master System", short: "Master System", maker: "Sega", year: 1986, kind: "console",
    folder: "Master System", aliases: ["sms", "mastersystem", "markiii"],
    exts: ["sms"], core: "genesis_plus_gx", cores: ["genesis_plus_gx", "smsplus", "picodrive"],
    dats: [NOINTRO("Sega - Master System - Mark III")],
    meta: "Sega - Master System - Mark III", thumbs: ["Sega - Master System - Mark III"],
    color: "#f43f5e", icon: "pad-sms", pad: "sms", status: "great", box: 0.72,
  },
  {
    id: "genesis", name: "Sega Genesis / Mega Drive", short: "Genesis", maker: "Sega", year: 1989, kind: "console",
    folder: "Genesis", aliases: ["genesis", "megadrive", "md", "mega drive", "segagenesis"],
    exts: ["md", "gen", "smd", "68k", "sgd"], core: "genesis_plus_gx", cores: ["genesis_plus_gx", "picodrive"],
    dats: [NOINTRO("Sega - Mega Drive - Genesis"), "metadat/homebrew/Sega - Mega Drive - Genesis.dat"],
    meta: "Sega - Mega Drive - Genesis", thumbs: ["Sega - Mega Drive - Genesis"],
    color: "#3b82f6", icon: "pad-genesis", pad: "genesis", status: "great", box: 0.72,
  },
  {
    id: "gamegear", name: "Sega Game Gear", short: "Game Gear", maker: "Sega", year: 1990, kind: "handheld",
    folder: "Game Gear", aliases: ["gg", "gamegear"],
    exts: ["gg"], core: "genesis_plus_gx", cores: ["genesis_plus_gx"],
    dats: [NOINTRO("Sega - Game Gear")],
    meta: "Sega - Game Gear", thumbs: ["Sega - Game Gear"],
    color: "#0ea5e9", icon: "handheld-wide", pad: "sms", status: "great", box: 0.72,
  },
  {
    id: "sg1000", name: "Sega SG-1000", short: "SG-1000", maker: "Sega", year: 1983, kind: "console",
    folder: "SG-1000", aliases: ["sg1000", "sg-1000"],
    exts: ["sg"], core: "genesis_plus_gx", cores: ["genesis_plus_gx"],
    dats: [NOINTRO("Sega - SG-1000")],
    meta: "Sega - SG-1000", thumbs: ["Sega - SG-1000"],
    color: "#fb7185", icon: "pad-sms", pad: "sms", status: "great", box: 0.72,
  },
  {
    id: "32x", name: "Sega 32X", short: "32X", maker: "Sega", year: 1994, kind: "console",
    folder: "32X", aliases: ["32x", "sega32x"],
    exts: ["32x"], core: "picodrive", cores: ["picodrive"],
    dats: [NOINTRO("Sega - 32X")],
    meta: "Sega - 32X", thumbs: ["Sega - 32X"],
    color: "#facc15", icon: "pad-genesis", pad: "genesis", status: "good", box: 0.72,
  },
  {
    id: "saturn", name: "Sega Saturn", short: "Saturn", maker: "Sega", year: 1995, kind: "console",
    folder: "Saturn", aliases: ["saturn", "segasaturn"],
    exts: [], discExts: ["cue", "chd", "iso", "ccd", "mds", "m3u"], core: "yabause", cores: ["yabause"],
    dats: [REDUMP("Sega - Saturn")], disc: true,
    meta: "Sega - Saturn", thumbs: ["Sega - Saturn"],
    color: "#a5b4fc", icon: "pad-saturn", pad: "saturn", status: "experimental", box: 0.72,
    note: "Uses a built-in BIOS replacement. Many games run, some don't, and it needs a fast device.",
    builtinBios: "Yabause's built-in BIOS",
    bios: { required: false, files: [{ name: "saturn_bios.bin", md5: "af5828fdff51384f99b3c4926be27762", label: "Saturn BIOS" }] },
  },
  {
    id: "segacd", name: "Sega CD / Mega-CD", short: "Sega CD", maker: "Sega", year: 1992, kind: "console",
    folder: "Sega CD", aliases: ["segacd", "megacd", "mega-cd"],
    exts: [], discExts: ["cue", "chd", "iso", "m3u"], core: "genesis_plus_gx", cores: ["genesis_plus_gx", "picodrive"],
    dats: [REDUMP("Sega - Mega-CD - Sega CD")], disc: true,
    meta: "Sega - Mega-CD - Sega CD", thumbs: ["Sega - Mega-CD - Sega CD"],
    color: "#64748b", icon: "disc", pad: "genesis", status: "great", box: 0.72,
    bios: { required: true, files: [
      { name: "bios_CD_U.bin", md5: "2efd74e3232ff260e371b99f84024f7f", label: "US Sega CD BIOS" },
      { name: "bios_CD_E.bin", md5: "e66fa1dc5820d254611fdcdba0662372", label: "EU Mega-CD BIOS" },
      { name: "bios_CD_J.bin", md5: "278a9397d192149e84e820ac621a8edd", label: "JP Mega-CD BIOS" },
    ] },
  },
  {
    id: "dreamcast", name: "Sega Dreamcast", short: "Dreamcast", maker: "Sega", year: 1998, kind: "console",
    folder: "Dreamcast", aliases: ["dreamcast", "dc", "segadreamcast"],
    exts: ["gdi", "cdi"], discExts: ["chd", "cue", "m3u"], core: null, cores: [], native: "flycast",
    dats: [REDUMP("Sega - Dreamcast")], disc: true,
    meta: "Sega - Dreamcast", thumbs: ["Sega - Dreamcast"],
    color: "#f97316", icon: "disc", pad: "saturn", status: "great", box: 1,
    builtinBios: "Dreamcast BIOS replacement built into Flycast",
  },
  // ---- Sony ----
  {
    id: "psx", name: "PlayStation", short: "PlayStation", maker: "Sony", year: 1994, kind: "console",
    folder: "PlayStation", aliases: ["psx", "ps1", "playstation", "psone", "playstation1"],
    exts: [], discExts: ["cue", "chd", "pbp", "m3u", "iso", "img", "ccd", "toc", "exe"], core: "pcsx_rearmed", cores: ["pcsx_rearmed", "mednafen_psx_hw"],
    dats: [REDUMP("Sony - PlayStation")], disc: true,
    meta: "Sony - PlayStation", thumbs: ["Sony - PlayStation"],
    color: "#94a3b8", icon: "pad-ps", pad: "psx", status: "great", box: 1,
    note: "Uses a built-in BIOS replacement, so no BIOS file is needed.",
    // OpenBIOS is an open-source PlayStation BIOS; pcsx_rearmed loads it under a standard name.
    includedBios: [{ name: "scph5501.bin", file: "openbios.bin", label: "OpenBIOS, open-source PlayStation BIOS (MIT)" }],
    bios: { required: false, files: [
      { name: "scph5501.bin", md5: "490f666e1afb15b7362b406ed1cea246", label: "PS1 BIOS (US)" },
      { name: "scph5500.bin", md5: "8dd7d5296a650fac7319bce665a6a53c", label: "PS1 BIOS (JP)" },
      { name: "scph5502.bin", md5: "32736f17079d0b2b7024407c39bd3050", label: "PS1 BIOS (EU)" },
      { name: "scph1001.bin", md5: "924e392ed05558ffdb115408c263dccf", label: "PS1 BIOS (US, early)" },
      { name: "scph7001.bin", md5: "1e68c231d0896b7eadcad1d7d8e76129", label: "PS1 BIOS (US, late)" },
      { name: "scph101.bin", md5: "6e3735ff4c7dc899ee98981385f6f3d0", label: "PSone BIOS" },
    ] },
  },
  {
    id: "psp", name: "PlayStation Portable", short: "PSP", maker: "Sony", year: 2004, kind: "handheld",
    folder: "PSP", aliases: ["psp", "playstationportable"],
    exts: ["cso"], discExts: ["iso", "cso", "pbp", "chd"], core: "ppsspp", cores: ["ppsspp"],
    dats: [REDUMP("Sony - PlayStation Portable"), NOINTRO("Sony - PlayStation Portable (PSN)")], disc: true,
    meta: "Sony - PlayStation Portable", thumbs: ["Sony - PlayStation Portable"],
    color: "#60a5fa", icon: "psp", pad: "psp", status: "experimental", threads: true, box: 0.58,
    note: "Needs a fast PC or recent phone. Runs best in Chrome or Edge.",
    builtinBios: "PPSSPP's built-in system software",
  },
  {
    id: "ps2", name: "PlayStation 2", short: "PS2", maker: "Sony", year: 2000, kind: "console",
    folder: "PS2", aliases: ["ps2", "playstation2", "sonyplaystation2"],
    exts: [], discExts: ["iso", "chd", "cue", "bin", "gz", "zso", "m3u"], core: null, cores: [], native: "pcsx2",
    dats: [REDUMP("Sony - PlayStation 2")], disc: true,
    meta: "Sony - PlayStation 2", thumbs: ["Sony - PlayStation 2"],
    color: "#2563eb", icon: "disc", pad: "psx", status: "great", box: 0.71,
    needs: { files: "ps2", chip: "Needs BIOS", label: "your PS2 BIOS", help: "PS2 games need the BIOS from your own PlayStation 2 (a 4 MB .bin file such as SCPH-70012.bin). Drop it into the BIOS folder or onto this window." },
  },
  {
    id: "ps3", name: "PlayStation 3", short: "PS3", maker: "Sony", year: 2006, kind: "console",
    folder: "PS3", aliases: ["ps3", "playstation3", "sonyplaystation3"],
    exts: [], discExts: ["iso"], core: null, cores: [], native: "rpcs3", folderGames: true,
    dats: [REDUMP("Sony - PlayStation 3"), NOINTRO("Sony - PlayStation 3 (PSN)")], disc: true,
    meta: "Sony - PlayStation 3", thumbs: ["Sony - PlayStation 3", "Sony - PlayStation 3 Downloadable"],
    color: "#334155", icon: "disc", pad: "psx", status: "good", box: 0.86,
    needs: { files: "ps3", chip: "Needs firmware", label: "the PS3 system software", help: "PS3 games need Sony's PS3 system software (PS3UPDAT.PUP), a free download from PlayStation's website. Drop the file into the BIOS folder or onto this window and Phosphor installs it the first time you play.",
      link: { href: "https://www.playstation.com/en-us/support/hardware/ps3/system-software/", label: "Get it from PlayStation" } },
    note: "Put each game in its own folder (with PS3_GAME or USRDIR inside), or as an .iso.",
  },
  {
    id: "ps4", name: "PlayStation 4", short: "PS4", maker: "Sony", year: 2013, kind: "console",
    folder: "PS4", aliases: ["ps4", "playstation4", "sonyplaystation4"],
    exts: [], discExts: [], core: null, cores: [], native: "shadps4", folderGames: true,
    dats: [], meta: null, thumbs: ["Sony - PlayStation 4"],
    color: "#1d4ed8", icon: "disc", pad: "psx", status: "experimental", box: 0.86,
    note: "PS4 emulation is young: some games play, many don't yet. Put each game in its own folder (with eboot.bin and sce_sys inside).",
  },
  {
    id: "vita", name: "PlayStation Vita", short: "PS Vita", maker: "Sony", year: 2011, kind: "handheld",
    folder: "PS Vita", aliases: ["vita", "psvita", "playstationvita", "psv"],
    exts: ["vpk"], discExts: [], core: null, cores: [], native: "vita3k", folderGames: true,
    dats: [NOINTRO("Sony - PlayStation Vita"), NOINTRO("Sony - PlayStation Vita (PSN)")],
    meta: "Sony - PlayStation Vita", thumbs: ["Sony - PlayStation Vita"],
    color: "#0ea5e9", icon: "psp", pad: "psp", status: "good", box: 0.58,
    needs: { files: "vita", chip: "Needs 2 files from Sony", label: "the PS Vita system software and font package", help: "PS Vita games need two free files from Sony: the system software (PSVUPDAT.PUP, from PlayStation's website) and the font package (PSP2UPDAT.PUP, about 57 MB). Drop both into the BIOS folder or onto this window and Phosphor installs them the first time you play.",
      link: { href: "https://www.playstation.com/en-us/support/hardware/psvita/system-software/", label: "System software (PlayStation)" },
      links: [{ href: "http://dus01.psp2.update.playstation.net/update/psp2/image/2019_0924/sd_8b5f60b56c3da8365b973dba570c53a5/PSP2UPDAT.PUP?dest=us", label: "Font package (Sony)" }] },
  },
  // ---- Atari ----
  {
    id: "atari2600", name: "Atari 2600", short: "Atari 2600", maker: "Atari", year: 1977, kind: "console",
    folder: "Atari 2600", aliases: ["atari2600", "2600", "a2600", "vcs"],
    exts: ["a26"], core: "stella2014", cores: ["stella2014"],
    dats: [NOINTRO("Atari - 2600")],
    meta: "Atari - 2600", thumbs: ["Atari - 2600"],
    color: "#d97706", icon: "joystick", pad: "atari", status: "great", box: 0.72,
  },
  {
    id: "atari5200", name: "Atari 5200", short: "Atari 5200", maker: "Atari", year: 1982, kind: "console",
    folder: "Atari 5200", aliases: ["atari5200", "5200", "a5200"],
    exts: ["a52"], core: "a5200", cores: ["a5200"],
    dats: [NOINTRO("Atari - 5200")],
    meta: "Atari - 5200", thumbs: ["Atari - 5200"],
    color: "#a8a29e", icon: "joystick", pad: "atari5200", status: "good", box: 0.72,
    builtinBios: "a5200's built-in BIOS",
    bios: { required: false, files: [{ name: "5200.rom", md5: "281f20ea4320404ec820fb7ec0693b38", label: "Atari 5200 BIOS" }] },
  },
  {
    id: "atari7800", name: "Atari 7800", short: "Atari 7800", maker: "Atari", year: 1986, kind: "console",
    folder: "Atari 7800", aliases: ["atari7800", "7800", "a7800"],
    exts: ["a78"], core: "prosystem", cores: ["prosystem"],
    dats: [NOINTRO("Atari - 7800"), "metadat/headered/Atari - 7800.dat"],
    meta: "Atari - 7800", thumbs: ["Atari - 7800"],
    color: "#dc2626", icon: "joystick", pad: "atari7800", headerSkip: 128, status: "great", box: 0.72,
    bios: { required: false, files: [{ name: "7800 BIOS (U).rom", md5: "0763f1ffb006ddbe32e52d497ee848ae", label: "Atari 7800 BIOS" }] },
  },
  {
    id: "jaguar", name: "Atari Jaguar", short: "Jaguar", maker: "Atari", year: 1993, kind: "console",
    folder: "Atari Jaguar", aliases: ["jaguar", "atarijaguar"],
    exts: ["j64", "jag", "abs", "cof"], core: "virtualjaguar", cores: ["virtualjaguar"],
    dats: [NOINTRO("Atari - Jaguar")],
    meta: "Atari - Jaguar", thumbs: ["Atari - Jaguar"],
    color: "#b91c1c", icon: "pad-jaguar", pad: "jaguar", status: "experimental", box: 0.72,
  },
  {
    id: "lynx", name: "Atari Lynx", short: "Lynx", maker: "Atari", year: 1989, kind: "handheld",
    folder: "Atari Lynx", aliases: ["lynx", "atarilynx"],
    exts: ["lnx", "o"], core: "handy", cores: ["handy"],
    dats: [NOINTRO("Atari - Lynx"), "metadat/headered/Atari - Lynx.dat"],
    meta: "Atari - Lynx", thumbs: ["Atari - Lynx"],
    color: "#f59e0b", icon: "handheld-wide", pad: "lynx", headerSkip: 64, status: "great", box: 0.72,
    bios: { required: true, files: [{ name: "lynxboot.img", md5: "fcd403db69f54290b51035d82f835e7b", label: "Lynx boot ROM" }] },
  },
  // ---- NEC / SNK / Bandai / Coleco / 3DO ----
  {
    id: "pce", name: "TurboGrafx-16 / PC Engine", short: "TurboGrafx-16", maker: "NEC", year: 1987, kind: "console",
    folder: "TurboGrafx-16", aliases: ["pce", "pcengine", "tg16", "turbografx", "turbografx16", "supergrafx", "sgx"],
    exts: ["pce", "sgx"], core: "mednafen_pce", cores: ["mednafen_pce"],
    dats: [NOINTRO("NEC - PC Engine - TurboGrafx 16"), NOINTRO("NEC - PC Engine SuperGrafx")],
    meta: "NEC - PC Engine - TurboGrafx 16", thumbs: ["NEC - PC Engine - TurboGrafx 16", "NEC - PC Engine SuperGrafx"],
    color: "#f97316", icon: "pad-pce", pad: "pce", status: "great", box: 0.85,
  },
  {
    id: "pcecd", name: "TurboGrafx-CD / PC Engine CD", short: "TurboGrafx-CD", maker: "NEC", year: 1988, kind: "console",
    folder: "TurboGrafx-CD", aliases: ["pcecd", "pcenginecd", "tgcd", "turbografxcd"],
    exts: [], discExts: ["cue", "chd", "ccd", "m3u"], core: "mednafen_pce", cores: ["mednafen_pce"],
    dats: [REDUMP("NEC - PC Engine CD - TurboGrafx-CD")], disc: true,
    meta: "NEC - PC Engine CD - TurboGrafx-CD", thumbs: ["NEC - PC Engine CD - TurboGrafx-CD"],
    color: "#fb923c", icon: "disc", pad: "pce", status: "great", box: 0.85,
    bios: { required: true, files: [{ name: "syscard3.pce", md5: "38179df8f4ac870017db21ebcbf53114", label: "System Card 3.0" }] },
  },
  {
    id: "ngp", name: "Neo Geo Pocket / Color", short: "Neo Geo Pocket", maker: "SNK", year: 1998, kind: "handheld",
    folder: "Neo Geo Pocket", aliases: ["ngp", "ngpc", "neogeopocket", "neogeopocketcolor"],
    exts: ["ngp", "ngc", "ngpc", "npc"], core: "mednafen_ngp", cores: ["mednafen_ngp"],
    dats: [NOINTRO("SNK - Neo Geo Pocket"), NOINTRO("SNK - Neo Geo Pocket Color")],
    meta: "SNK - Neo Geo Pocket Color", thumbs: ["SNK - Neo Geo Pocket Color", "SNK - Neo Geo Pocket"],
    color: "#14b8a6", icon: "handheld-wide", pad: "ngp", status: "great", box: 0.72,
  },
  {
    id: "wonderswan", name: "WonderSwan / Color", short: "WonderSwan", maker: "Bandai", year: 1999, kind: "handheld",
    folder: "WonderSwan", aliases: ["ws", "wsc", "wonderswan", "wonderswancolor"],
    exts: ["ws", "wsc", "pc2"], core: "mednafen_wswan", cores: ["mednafen_wswan"],
    dats: [NOINTRO("Bandai - WonderSwan"), NOINTRO("Bandai - WonderSwan Color")],
    meta: "Bandai - WonderSwan Color", thumbs: ["Bandai - WonderSwan Color", "Bandai - WonderSwan"],
    color: "#eab308", icon: "handheld-wide", pad: "ws", status: "great", box: 0.72,
  },
  {
    id: "coleco", name: "ColecoVision", short: "ColecoVision", maker: "Coleco", year: 1982, kind: "console",
    folder: "ColecoVision", aliases: ["coleco", "colecovision"],
    exts: ["col", "cv"], core: "gearcoleco", cores: ["gearcoleco"],
    dats: [NOINTRO("Coleco - ColecoVision")],
    meta: "Coleco - ColecoVision", thumbs: ["Coleco - ColecoVision"],
    color: "#78716c", icon: "joystick", pad: "coleco", status: "great", box: 0.72,
    bios: { required: true, files: [{ name: "colecovision.rom", md5: "2c66f5911e5b42b8ebe113403548eee7", label: "ColecoVision BIOS" }] },
  },
  {
    id: "3do", name: "3DO Interactive Multiplayer", short: "3DO", maker: "Panasonic", year: 1993, kind: "console",
    folder: "3DO", aliases: ["3do", "panasonic3do"],
    exts: [], discExts: ["cue", "chd", "iso"], core: "opera", cores: ["opera"],
    dats: [REDUMP("The 3DO Company - 3DO")], disc: true,
    meta: "The 3DO Company - 3DO", thumbs: ["The 3DO Company - 3DO"],
    color: "#d4a017", icon: "disc", pad: "3do", status: "experimental", box: 0.72,
    bios: { required: true, files: [
      { name: "panafz10.bin", md5: "51f2f43ae2f3508a14d9f56597e2d3ce", label: "Panasonic FZ-10 BIOS" },
      { name: "panafz1.bin", md5: "f47264dd47fe30f73ab3c010015c155b", label: "Panasonic FZ-1 BIOS" },
      { name: "goldstar.bin", md5: "8639fd5e549bd6238cfee79e3e749114", label: "Goldstar BIOS" },
    ] },
  },
  // ---- Microsoft ----
  {
    id: "xbox", name: "Xbox", short: "Xbox", maker: "Microsoft", year: 2001, kind: "console",
    folder: "Xbox", aliases: ["xbox", "microsoftxbox", "ogxbox"],
    exts: ["xiso"], discExts: ["iso"], core: null, cores: [], native: "xemu",
    dats: [REDUMP("Microsoft - Xbox")], disc: true,
    meta: "Microsoft - Xbox", thumbs: ["Microsoft - Xbox"],
    color: "#16a34a", icon: "disc", pad: "snes", status: "good", box: 0.71,
    needs: { files: "xbox", chip: "Needs BIOS", label: "your Xbox BIOS", help: "Xbox games need two files from your own Xbox: the MCPX boot ROM (512 bytes, e.g. mcpx_1.0.bin) and the flash BIOS (256 KB or 1 MB .bin). Drop them into the BIOS folder or onto this window." },
    note: "Use games in XISO format (.iso). Phosphor gives each player a blank hard drive for saves.",
  },
  {
    id: "xbox360", name: "Xbox 360", short: "Xbox 360", maker: "Microsoft", year: 2005, kind: "console",
    folder: "Xbox 360", aliases: ["xbox360", "x360", "microsoftxbox360"],
    exts: ["xex"], discExts: ["iso"], core: null, cores: [], native: "xenia",
    dats: [REDUMP("Microsoft - Xbox 360")], disc: true,
    meta: "Microsoft - Xbox 360", thumbs: ["Microsoft - Xbox 360"],
    color: "#65a30d", icon: "disc", pad: "snes", status: "experimental", box: 0.71,
    note: "Xbox 360 games play in the Windows version of the desktop app.",
  },
  // ---- Arcade ----
  {
    id: "arcade", name: "Arcade", short: "Arcade", maker: "Various", year: 1978, kind: "arcade",
    folder: "Arcade", aliases: ["arcade", "fbneo", "fba", "mame", "neogeo", "cps1", "cps2", "cps3"],
    exts: [], core: "fbneo", cores: ["fbneo", "mame2003_plus"],
    dats: ["metadat/fbneo-split/FBNeo - Arcade Games.dat"], arcade: true,
    meta: "FBNeo - Arcade Games", thumbs: ["FBNeo - Arcade Games", "MAME"],
    color: "#ec4899", icon: "arcade", pad: "arcade", status: "great", box: 0.75,
    note: "Use FinalBurn Neo romsets, one .zip per game. Neo Geo games also need neogeo.zip in the BIOS folder.",
  },
  // ---- Computers ----
  {
    id: "c64", name: "Commodore 64", short: "C64", maker: "Commodore", year: 1982, kind: "computer",
    folder: "Commodore 64", aliases: ["c64", "commodore64"],
    exts: ["d64", "t64", "prg", "crt", "tap", "g64", "x64", "d71", "d81", "p00"], core: "vice_x64sc", cores: ["vice_x64sc"],
    dats: [NOINTRO("Commodore - 64")],
    meta: "Commodore - 64", thumbs: ["Commodore - 64"],
    color: "#6366f1", icon: "computer", pad: "c64", status: "great", box: 0.72,
    builtinBios: "Commodore ROMs included with VICE",
  },
  {
    id: "c128", name: "Commodore 128", short: "C128", maker: "Commodore", year: 1985, kind: "computer",
    folder: "Commodore 128", aliases: ["c128", "commodore128"],
    exts: ["d64", "d71", "d81", "prg", "t64", "crt", "g64", "p00"], core: "vice_x128", cores: ["vice_x128"],
    dats: [], meta: null, thumbs: ["Commodore - 64"],
    color: "#8b5cf6", icon: "computer", pad: "c64", status: "great", box: 0.72,
    builtinBios: "Commodore ROMs included with VICE",
  },
  {
    id: "vic20", name: "Commodore VIC-20", short: "VIC-20", maker: "Commodore", year: 1980, kind: "computer",
    folder: "VIC-20", aliases: ["vic20", "vic", "commodorevic20"],
    exts: ["20", "40", "60", "a0", "b0", "crt", "prg", "d64", "t64", "tap"], core: "vice_xvic", cores: ["vice_xvic"],
    dats: [NOINTRO("Commodore - VIC-20")],
    meta: "Commodore - VIC-20", thumbs: ["Commodore - VIC-20"],
    color: "#c084fc", icon: "computer", pad: "c64", status: "great", box: 0.72,
    builtinBios: "Commodore ROMs included with VICE",
  },
  {
    id: "plus4", name: "Commodore Plus/4", short: "Plus/4", maker: "Commodore", year: 1984, kind: "computer",
    folder: "Commodore Plus-4", aliases: ["plus4", "c16", "commodoreplus4", "commodore16"],
    exts: ["prg", "d64", "t64", "tap", "crt"], core: "vice_xplus4", cores: ["vice_xplus4"],
    dats: [NOINTRO("Commodore - Plus-4")],
    meta: "Commodore - Plus-4", thumbs: ["Commodore - Plus-4"],
    color: "#64748b", icon: "computer", pad: "c64", status: "great", box: 0.72,
    builtinBios: "Commodore ROMs included with VICE",
  },
  {
    id: "pet", name: "Commodore PET", short: "PET", maker: "Commodore", year: 1977, kind: "computer",
    folder: "Commodore PET", aliases: ["pet", "commodorepet", "cbm"],
    exts: ["prg", "d64", "d80", "d82", "t64", "tap"], core: "vice_xpet", cores: ["vice_xpet"],
    dats: [], meta: null, thumbs: ["Commodore - PET"],
    color: "#a3a3a3", icon: "computer", pad: "c64", status: "great", box: 0.72,
    builtinBios: "Commodore ROMs included with VICE",
  },
  {
    id: "amiga", name: "Commodore Amiga", short: "Amiga", maker: "Commodore", year: 1985, kind: "computer",
    folder: "Amiga", aliases: ["amiga"],
    exts: ["adf", "adz", "dms", "ipf", "hdf", "hdz", "lha", "uae"], core: "puae", cores: ["puae"],
    dats: [NOINTRO("Commodore - Amiga")],
    meta: "Commodore - Amiga", thumbs: ["Commodore - Amiga"],
    color: "#e11d48", icon: "computer", pad: "amiga", status: "experimental", box: 0.72,
    note: "Uses the open AROS Kickstart replacement. Some games need the real Kickstart ROM.",
    builtinBios: "AROS Kickstart, built into PUAE",
    bios: { required: false, files: [
      { name: "kick34005.A500", md5: "82a21c1890cae844b3df741f2762d48d", label: "Kickstart 1.3 (A500)" },
      { name: "kick40068.A1200", md5: "646773759326fbac3b2311fd8c8793ee", label: "Kickstart 3.1 (A1200)" },
    ] },
  },
  {
    id: "dos", name: "MS-DOS", short: "DOS", maker: "PC", year: 1981, kind: "computer",
    folder: "DOS", aliases: ["dos", "msdos", "pc"],
    exts: ["dosz", "exe", "com", "bat"], core: "dosbox_pure", cores: ["dosbox_pure"],
    dats: [], meta: "DOS", thumbs: ["DOS"],
    color: "#22d3ee", icon: "computer", pad: "dos", status: "good", threads: true, box: 0.8,
    note: "Put each game in its own .zip. Phosphor finds the right program to start.",
  },
  {
    id: "doom", name: "Doom engine games", short: "Doom", maker: "id Software", year: 1993, kind: "computer",
    folder: "Doom", aliases: ["doom", "prboom", "wad"],
    exts: ["wad"], core: "prboom", cores: ["prboom"],
    dats: [], meta: null, thumbs: ["DOOM"],
    color: "#dc2626", icon: "computer", pad: "dos", status: "great", box: 0.8,
    note: "Drop .wad files: Doom, Doom II, Final Doom, mods, or the free Freedoom games.",
  },
  {
    id: "zxspectrum", name: "ZX Spectrum", short: "ZX Spectrum", maker: "Sinclair", year: 1982, kind: "computer",
    folder: "ZX Spectrum", aliases: ["zxspectrum", "zx", "spectrum"],
    exts: ["tzx", "tap", "z80", "sna", "szx", "rzx", "scl", "trd"], core: "fuse", cores: ["fuse"],
    dats: [NOINTRO("Sinclair - ZX Spectrum +3")],
    meta: "Sinclair - ZX Spectrum +3", thumbs: ["Sinclair - ZX Spectrum +3", "Sinclair - ZX Spectrum"],
    color: "#f87171", icon: "computer", pad: "zx", status: "great", box: 0.72,
    builtinBios: "Spectrum ROMs included with Fuse",
  },
  {
    id: "zx81", name: "Sinclair ZX81", short: "ZX81", maker: "Sinclair", year: 1981, kind: "computer",
    folder: "ZX81", aliases: ["zx81", "sinclairzx81", "ts1000"],
    exts: ["p", "t81", "tzx"], core: "81", cores: ["81"],
    dats: [], meta: null, thumbs: ["Sinclair - ZX 81"],
    color: "#fb923c", icon: "computer", pad: "zx", status: "great", box: 0.72,
    builtinBios: "ZX81 ROM included with EightyOne",
  },
  {
    id: "cpc", name: "Amstrad CPC", short: "Amstrad CPC", maker: "Amstrad", year: 1984, kind: "computer",
    folder: "Amstrad CPC", aliases: ["cpc", "amstradcpc", "amstrad"],
    exts: ["dsk", "sna", "cdt", "kcr", "voc"], core: "cap32", cores: ["cap32"],
    dats: [], meta: "Amstrad - CPC", thumbs: ["Amstrad - CPC"],
    color: "#10b981", icon: "computer", pad: "cpc", status: "great", box: 0.72,
    builtinBios: "CPC ROMs included with Caprice32",
  },

  // ---- desktop extras: played in RetroArch (desktop app), one libretro core each (RA_CORES in native/catalog.js) ----
  // No EmulatorJS core exists for these, so they need the desktop app. Free BIOS replacements
  // (C-BIOS, EmuTOS) ship in bios/retroarch; the rest stay hidden until the player's BIOS is there.
  {
    id: "vectrex", name: "GCE Vectrex", short: "Vectrex", maker: "GCE", year: 1982, kind: "console",
    folder: "Vectrex", aliases: ["vectrex", "gcevectrex"],
    exts: ["vec", "gam", "bin"], core: null, cores: [], native: "retroarch",
    dats: [NOINTRO("GCE - Vectrex")], meta: "GCE - Vectrex", thumbs: ["GCE - Vectrex"],
    color: "#e11d48", icon: "joystick", pad: "atari", status: "great", box: 0.72,
    builtinBios: "Vectrex BIOS built into vecx",
  },
  {
    id: "pokemini", name: "Nintendo Pokémon mini", short: "Pokémon mini", maker: "Nintendo", year: 2001, kind: "handheld",
    folder: "Pokemon mini", aliases: ["pokemini", "pokemonmini", "pmini"],
    exts: ["min"], core: null, cores: [], native: "retroarch",
    dats: [NOINTRO("Nintendo - Pokemon Mini")], meta: "Nintendo - Pokemon Mini", thumbs: ["Nintendo - Pokemon Mini"],
    color: "#38bdf8", icon: "gb", pad: "gb", status: "great", box: 0.72,
    builtinBios: "Free Pokémon mini BIOS built into PokeMini",
    bios: { required: false, files: [{ name: "bios.min", md5: "1e4fb124a3a886865acb574f388c803d", label: "Pokémon mini BIOS (optional)" }] },
  },
  {
    id: "msx", name: "MSX / MSX2", short: "MSX", maker: "Microsoft / ASCII", year: 1983, kind: "computer",
    folder: "MSX", aliases: ["msx", "msx1", "msx2", "msx2plus"],
    exts: ["mx1", "mx2", "ri", "dsk", "cas", "rom"], core: null, cores: [], native: "retroarch",
    dats: [NOINTRO("Microsoft - MSX"), NOINTRO("Microsoft - MSX2")], meta: "Microsoft - MSX", thumbs: ["Microsoft - MSX", "Microsoft - MSX2"],
    color: "#a3e635", icon: "computer", pad: "c64", status: "great", box: 0.72,
    includedBios: [{ name: "Machines", file: "retroarch/Machines", label: "C-BIOS (free MSX BIOS, BSD license)" }],
    note: "Cartridge games run on C-BIOS, a free MSX BIOS that comes with Phosphor. Disk and tape games need a real MSX BIOS, which C-BIOS can't replace.",
  },
  {
    id: "atarist", name: "Atari ST", short: "Atari ST", maker: "Atari", year: 1985, kind: "computer",
    folder: "Atari ST", aliases: ["atarist", "st", "atari-st", "ste"],
    exts: ["st", "msa", "stx", "dim", "ipf"], core: null, cores: [], native: "retroarch",
    dats: [NOINTRO("Atari - ST")], meta: "Atari - ST", thumbs: ["Atari - ST"],
    color: "#94a3b8", icon: "computer", pad: "amiga", status: "good", box: 0.72,
    includedBios: [{ name: "tos.img", file: "retroarch/tos.img", label: "EmuTOS 1.4 (free Atari TOS, GPL)" }],
    bios: { required: false, files: [{ name: "tos.img", md5: "c1c57ce48e8ee4135885cee9e63a68a2", label: "Atari TOS (optional; EmuTOS is used otherwise)" }] },
  },
  {
    id: "atari800", name: "Atari 8-bit (400/800/XL/XE)", short: "Atari 800", maker: "Atari", year: 1979, kind: "computer",
    folder: "Atari 800", aliases: ["atari800", "atari8bit", "atarixl", "atarixe", "a800"],
    exts: ["atr", "xfd", "atx", "dcm", "cas", "xex", "car", "com"], core: null, cores: [], native: "retroarch",
    dats: [NOINTRO("Atari - 8-bit Family")], meta: "Atari - 8-bit Family", thumbs: ["Atari - 8-bit Family"],
    color: "#f59e0b", icon: "computer", pad: "atari", status: "good", box: 0.72,
    builtinBios: "Free Altirra OS built into Atari800",
    bios: { required: false, files: [
      { name: "ATARIXL.ROM", md5: "06daac977823773a3eea3422fd26a703", label: "Atari XL/XE OS (optional)" },
      { name: "ATARIBAS.ROM", md5: "0bac0c6a50104045d902df4503a4c30b", label: "Atari BASIC (optional)" },
    ] },
  },
  {
    id: "intellivision", name: "Mattel Intellivision", short: "Intellivision", maker: "Mattel", year: 1979, kind: "console",
    folder: "Intellivision", aliases: ["intellivision", "intv"],
    exts: ["int", "itv", "bin", "rom"], core: null, cores: [], native: "retroarch",
    dats: [NOINTRO("Mattel - Intellivision")], meta: "Mattel - Intellivision", thumbs: ["Mattel - Intellivision"],
    color: "#b45309", icon: "joystick", pad: "coleco", status: "good", box: 0.72,
    bios: { required: true, files: [
      { name: "exec.bin", md5: "62e761035cb657903761800f4437b8af", label: "Intellivision Executive ROM" },
      { name: "grom.bin", md5: "0cd5946c6473e42e8e4c2137785e427f", label: "Intellivision Graphics ROM" },
    ] },
  },
  {
    id: "odyssey2", name: "Magnavox Odyssey² / Videopac", short: "Odyssey²", maker: "Magnavox / Philips", year: 1978, kind: "console",
    folder: "Odyssey2", aliases: ["odyssey2", "o2", "videopac"],
    exts: ["bin"], core: null, cores: [], native: "retroarch",
    dats: [NOINTRO("Magnavox - Odyssey2")], meta: "Magnavox - Odyssey2", thumbs: ["Magnavox - Odyssey2"],
    color: "#64748b", icon: "joystick", pad: "atari", status: "good", box: 0.72,
    bios: { required: true, files: [{ name: "o2rom.bin", md5: "562d5ebf9e030a40d6fabfc2f33139fd", label: "Odyssey² BIOS" }] },
  },
  {
    id: "channelf", name: "Fairchild Channel F", short: "Channel F", maker: "Fairchild", year: 1976, kind: "console",
    folder: "Channel F", aliases: ["channelf", "fairchild", "chf"],
    exts: ["chf", "bin"], core: null, cores: [], native: "retroarch",
    dats: [NOINTRO("Fairchild - Channel F")], meta: "Fairchild - Channel F", thumbs: ["Fairchild - Channel F"],
    color: "#a16207", icon: "joystick", pad: "atari", status: "good", box: 0.72,
    bios: { required: true, files: [
      { name: "sl31253.bin", md5: "ac9804d4c0e9d07e33472e3726ed15c3", label: "Channel F BIOS (SL31253)" },
      { name: "sl31254.bin", md5: "da98f4bb3242ab80d76629021bb27585", label: "Channel F BIOS (SL31254)" },
    ] },
  },
  {
    id: "fds", name: "Famicom Disk System", short: "Famicom Disk", maker: "Nintendo", year: 1986, kind: "console",
    folder: "Famicom Disk System", aliases: ["fds", "famicomdisk", "famicomdisksystem"],
    exts: ["fds"], core: null, cores: [], native: "retroarch",
    dats: [NOINTRO("Nintendo - Family Computer Disk System")], meta: "Nintendo - Family Computer Disk System", thumbs: ["Nintendo - Family Computer Disk System"],
    color: "#dc2626", icon: "disc", pad: "nes", status: "great", box: 0.72,
    bios: { required: true, files: [{ name: "disksys.rom", md5: "ca30b50f880eb660a320674ed365ef7a", label: "Famicom Disk System BIOS" }] },
  },
  {
    id: "neogeocd", name: "Neo Geo CD", short: "Neo Geo CD", maker: "SNK", year: 1994, kind: "console",
    folder: "Neo Geo CD", aliases: ["neogeocd", "ngcd"],
    exts: [], discExts: ["cue", "chd"], core: null, cores: [], native: "retroarch",
    dats: [REDUMP("SNK - Neo Geo CD")], disc: true, meta: "SNK - Neo Geo CD", thumbs: ["SNK - Neo Geo CD"],
    color: "#2563eb", icon: "disc", pad: "arcade", status: "good", box: 1,
    // NeoCD needs a CD BIOS and the zoom ROM, in a "neocd" folder of RetroArch's system folder.
    bios: { required: true, raFolder: "neocd", files: [
      { name: "neocd_f.rom", md5: null, label: "Neo Geo CD front-loader BIOS" },
      { name: "neocd_t.rom", md5: null, label: "Neo Geo CD top-loader BIOS" },
      { name: "neocd_z.rom", md5: null, label: "Neo Geo CDZ BIOS" },
      { name: "front-sp1.bin", md5: null, label: "Neo Geo CD front-loader BIOS (MAME name)" },
      { name: "top-sp1.bin", md5: null, label: "Neo Geo CD top-loader BIOS (MAME name)" },
      { name: "neocd.bin", md5: null, label: "Neo Geo CDZ BIOS (MAME name)" },
      { name: "000-lo.lo", md5: null, label: "Neo Geo zoom ROM (needed with any of the above)" },
    ] },
  },
];

export const BY_ID = Object.fromEntries(SYSTEMS.map((s) => [s.id, s]));

// Every emulator core any system can use, so the updater knows what to fetch.
export const ALL_CORES = [...new Set(SYSTEMS.flatMap((s) => s.cores))];

// How each core is shown to people.
export const CORE_NAMES = {
  fceumm: "FCEUmm", nestopia: "Nestopia", snes9x: "Snes9x", mupen64plus_next: "Mupen64Plus-Next", parallel_n64: "ParaLLEl N64",
  gambatte: "Gambatte", mgba: "mGBA", desmume2015: "DeSmuME", melonds: "melonDS", desmume: "DeSmuME (new)", beetle_vb: "Beetle VB",
  genesis_plus_gx: "Genesis Plus GX", smsplus: "SMS Plus", picodrive: "PicoDrive", yabause: "Yabause", pcsx_rearmed: "PCSX ReARMed",
  mednafen_psx_hw: "Beetle PSX", ppsspp: "PPSSPP", stella2014: "Stella", a5200: "a5200", prosystem: "ProSystem",
  virtualjaguar: "Virtual Jaguar", handy: "Handy", mednafen_pce: "Beetle PCE", mednafen_ngp: "Beetle NeoPop", mednafen_wswan: "Beetle Cygne",
  gearcoleco: "Gearcoleco", opera: "Opera", fbneo: "FinalBurn Neo", mame2003_plus: "MAME 2003-Plus", vice_x64sc: "VICE (C64)",
  vice_x128: "VICE (C128)", vice_xvic: "VICE (VIC-20)", vice_xplus4: "VICE (Plus/4)", vice_xpet: "VICE (PET)", puae: "PUAE",
  dosbox_pure: "DOSBox Pure", prboom: "PrBoom", fuse: "Fuse", 81: "EightyOne", cap32: "Caprice32",
};
export const coreName = (c) => CORE_NAMES[c] || c;

// Folder name (lower-case, punctuation stripped) -> system id. Includes our folder names and the
// folder names other frontends (RetroArch, Batocera, ES-DE, RetroPie) use, so an existing ROM
// collection drops straight in.
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
export const FOLDER_INDEX = (() => {
  const idx = {};
  for (const s of SYSTEMS) {
    for (const a of [s.folder, s.id, s.short, s.name, ...s.aliases]) idx[norm(a)] = s.id;
  }
  return idx;
})();
export const systemForFolder = (name) => FOLDER_INDEX[norm(name)] || null;

// Extension -> system ids that claim it outright.
export const EXT_INDEX = (() => {
  const idx = {};
  for (const s of SYSTEMS) {
    for (const e of s.exts) (idx[e] ||= []).push(s.id);
  }
  return idx;
})();

// Extensions that more than one system uses; the identifier sniffs file headers to decide.
export const AMBIGUOUS_EXTS = new Set(["bin", "rom", "iso", "img", "cue", "chd", "ccd", "mds", "toc", "m3u", "zip", "7z", "pbp"]);

// Files that are part of a game but never a game on their own.
export const COMPANION_EXTS = new Set(["bin", "img", "sub", "ecm", "wav", "ogg", "mp3", "iso"]);

export function publicSystem(s) {
  return {
    id: s.id, name: s.name, short: s.short, maker: s.maker, year: s.year, kind: s.kind,
    folder: s.folder, exts: [...s.exts, ...(s.discExts || [])], color: s.color, icon: s.icon, photo: photoUrl(s.id),
    core: s.core, cores: s.cores, status: s.status, note: s.note || null, disc: !!s.disc, arcade: !!s.arcade, box: s.box,
    pad: s.pad, needsBios: !!s.bios?.required, threads: !!s.threads,
    // Consoles played in a desktop emulator (desktop app only) instead of in the browser.
    native: s.native || null, nativeName: s.native ? NATIVE[s.native].name : null,
    // Desktop consoles that need the player's own files (BIOS, keys, firmware) to start.
    needs: s.needs ? { chip: s.needs.chip, label: s.needs.label, help: s.needs.help, link: s.needs.link || null, links: [s.needs.link, ...(s.needs.links || [])].filter(Boolean) } : null,
    folderGames: !!s.folderGames,
    biosFiles: s.bios?.files?.map((f) => ({ name: f.name, label: f.label })) || [],
    // How this console's BIOS is handled: a free BIOS we ship, one built into the emulator,
    // not needed at all, or (5 systems) your own dump required.
    bios: s.bios?.required ? "yours" : s.includedBios ? "included" : s.builtinBios ? "builtin" : "none",
    biosLabel: s.includedBios?.[0]?.label || s.builtinBios || null,
  };
}
