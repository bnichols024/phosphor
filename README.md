# Phosphor

**Every classic, every screen, zero setup.**

Phosphor is a retro gaming app that runs on your home server and plays in any browser: TV, laptop,
tablet or phone. Every emulator is built in, the folders are already made, nothing needs a BIOS
file, and one button keeps every emulator up to date.

## What makes it different

| | RetroArch / EmuDeck / Batocera | RomM / EmulatorJS | **Phosphor** |
|---|---|---|---|
| Setup | Install per device, pick cores, find BIOS | Server + config | One container. Open a web page. |
| Adding games | Right folder, right name | Upload or folder | **Drop anything anywhere.** Zips, folders, mixed consoles: it works out the console from the file itself and files it. BIOS files too. |
| BIOS | You find them | You find them | **Handled for you.** Ships open-source BIOS files for PlayStation (OpenBIOS) and GBA; DS, Saturn, PSP, Amiga and others use BIOS replacements built into their emulators. Official BIOS you own are found anywhere and used automatically. Only 5 systems with no legal replacement wait for yours. |
| Emulator won't run a game | Change core in menus | Not possible | Crash or freeze is detected and the other emulator is one tap away, then remembered for that game |
| Updating emulators | Per core, per device | Manual | **One Update button**, atomic, with one-click undo. Or update (or roll back) any single emulator from its own row |
| Saves | Stuck on one device | Per browser | **Follow you.** In-game saves sync to the server, with the last 8 versions kept |
| Resume | Manual save states | Manual | **Pick up where you left off** on any device; Home shows the exact frame you quit on |
| Controllers | Configure per device | Basic | Plug in and go, the whole UI works with a controller, and **your phone is a controller** (scan a QR code, up to 4 players) |
| Multi-disc games | Write .m3u files | Write .m3u files | Grouped automatically, disc swapping just works |
| Players | One | Accounts | Netflix-style players, each with saves, favorites and play stats |
| First run | Empty | Empty | "Get free games" installs 12 great free games in one click, including the full Freedoom shooters and three Dreamcast games |
| Looks | Text lists or theme packs | Plain | Real studio photos of every console's controller, glowing in its own colour |

Full feature-by-feature comparison with RetroArch, EmulatorJS, RomM, LaunchBox, ES-DE/EmuDeck and
Batocera, including what's still missing: [docs/COMPARISON.md](docs/COMPARISON.md).

Also: box art, title screens and screenshots fetched automatically (libretro thumbnails), real names,
years, genres and player counts from No-Intro/Redump/FBNeo data, region variants collapsed to your
preferred region, shelves (collections), play-time stats and streaks, display filters (pixel perfect,
smooth, CRT, curved CRT, handheld LCD), fast forward, rewind, 8 save slots with screenshots, cloud
save history with restore, drag-and-drop uploads, "Surprise me", and an ambient glow that takes the
colours of whatever you're looking at, ROM patches applied automatically, video clips, kid mode with
a parent PIN, an attract-mode screensaver, game descriptions (Wikipedia, or ScreenScraper with ratings,
videos and manuals), and RetroAchievements progress for every player.

## Consoles

Every console Phosphor shows comes with its BIOS: PlayStation and Game Boy Advance get bundled
open-source BIOS files (OpenBIOS and Cult-of-GBA), DS, Saturn, PSP, Amiga and others use the BIOS
built into their emulators, and the rest never needed one:

NES, SNES, N64, Game Boy, Game Boy Color, Game Boy Advance, Nintendo DS, Virtual Boy, Master System,
Genesis/Mega Drive, Game Gear, SG-1000, 32X, Saturn (beta), PlayStation, PSP (beta),
Atari 2600/5200/7800, Jaguar (beta), TurboGrafx-16/PC Engine, Neo Geo Pocket, WonderSwan, Arcade
(FinalBurn Neo), Commodore 64, Commodore 128, VIC-20, Plus/4, PET, Amiga (beta), DOS, Doom (and Doom
mods), ZX Spectrum, ZX81, Amstrad CPC.

**In the desktop app**, Phosphor also plays the consoles no browser can, using the full desktop
emulators it ships with: Dreamcast (Flycast), GameCube and Wii (Dolphin). They open full screen,
controllers work without setup (Xbox-style pads on Windows), saves stay in your Phosphor folder,
and the same Update button keeps them current. PS2, PS3, Wii U, Switch, 3DS, Xbox, Xbox 360, Vita
and PS4 are next. In the server version those games show up in the library with a note to play
them in the desktop app.

Consoles that cannot start without their maker's copyrighted BIOS (Sega CD, TurboGrafx-CD, 3DO,
ColecoVision, Atari Lynx) are left out. If you own one of those BIOS files, drop it in and that
console appears automatically.

Phosphor never includes commercial games or copyrighted BIOS files. See `bios/README.md` for the
BIOS it does include and why.

## Download (desktop app)

Phosphor runs as a normal desktop app on Windows, macOS and Linux, with every emulator inside. Grab
the file for your computer from the Releases page:

| Computer | File | Notes |
|---|---|---|
| Windows 10/11 | `Phosphor-Setup-<version>.exe` | Not code-signed yet: on "Windows protected your PC" click More info › Run anyway |
| Mac (Apple Silicon) | `Phosphor-<version>-arm64-mac.zip` / `.dmg` | Not notarized yet: right-click the app › Open the first time |
| Mac (Intel) | `Phosphor-<version>-mac.zip` / `.dmg` | Same as above |
| Linux | `Phosphor-<version>.AppImage` | `chmod +x` and run; `.deb` and `.tar.gz` also available |

Your games live in a `Phosphor` folder in your home folder (change it in Settings › Library). Drop
games into `Phosphor/Drop Games Here` or onto the window. On the desktop, PSP and DOS games work
straight away, and phones on the same Wi-Fi can still join as controllers.

## Run it on a server (Docker)

```bash
docker build -t phosphor .
docker run -d -p 8795:8080 -p 8797:8443 -v /path/to/library:/phosphor --user 99:100 phosphor
```

Open `http://<server>:8795`. The library folder gets this layout:

```
library/
  Drop Games Here/   drop anything; it's sorted automatically
  ROMs/<console>/    or put games here yourself (RetroArch/Batocera folder names work too)
  BIOS/              optional: official BIOS files you own
  Saves/<player>/    standard .srm files (they work in RetroArch too)
  Screenshots/
  .phosphor/         database, box art cache, save states, emulator updates
```

PSP and DOS emulators use threads, which browsers only allow on secure pages: open those games via
the HTTPS port (`https://<server>:8797`, self-signed) or put Phosphor behind your own HTTPS reverse
proxy. Set `PHOSPHOR_TLS_CERT`/`PHOSPHOR_TLS_KEY` to use your own certificate, and
`PHOSPHOR_PUBLIC_URL` if the address phones should use differs from the one the TV opened.

## Develop

```bash
npm install
npm run emulators   # downloads every emulator into vendor/emulators (same code as the Update button)
npm run dev         # http://localhost:8080 with a library in ./dev-library
npm test            # unit + API tests
npm run db          # refresh the game database from libretro-database
```

Built on [EmulatorJS](https://emulatorjs.org) and libretro cores (GPL), libretro-database and
libretro-thumbnails. Controller photos come from Wikimedia Commons, most by Evan-Amos (public domain);
see [web/img/controllers/CREDITS.md](web/img/controllers/CREDITS.md). Settings › About in the app
has the full credits.
