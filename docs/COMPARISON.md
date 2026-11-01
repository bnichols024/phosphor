# Phosphor vs the competition

Feature by feature against RetroArch, EmulatorJS, RomM, LaunchBox / Big Box, ES-DE + EmuDeck and
Batocera. "Tested" means verified in a real browser against the running app on 2026-10-30.

Legend: ✅ has it · ⭐ has it and goes further · ❌ doesn't · — not applicable

## Setup and emulators

| Feature | RetroArch | EmulatorJS | RomM | LaunchBox | ES-DE/EmuDeck | Batocera | **Phosphor** |
|---|---|---|---|---|---|---|---|
| Emulators included | ✅ download per core | ✅ | via EmulatorJS | ❌ bring your own | ✅ EmuDeck installs | ✅ | ⭐ 42 in-browser emulators plus 11 desktop emulators in the desktop app (47 consoles and computers, PS2 to Switch), work offline (tested: NES, SNES, N64, GB, GBC, GBA, Genesis, PS1, PSP) |
| Update emulators | per core | manual | image update | manual | EmuDeck updater | OS update | ⭐ one Update button for all, or update any single emulator; atomic, one-click undo for all or per emulator (tested with a fake registry, incl. failed download) |
| Choose another emulator per game | ✅ manual | ❌ | ❌ | ✅ | ✅ | ✅ | ⭐ crash/freeze detected, "Try ParaLLEl N64" offered, choice remembered (tested) |
| Install per device | yes | no | no | Windows | per device | own OS | ⭐ none: any browser, TV/PC/phone |
| BIOS handling | find your own | find your own | BIOS upload | find your own | BIOS checker | BIOS checker | ⭐ ships open-source BIOS files (PlayStation OpenBIOS, GBA), uses emulators' built-in BIOS (DS, Saturn, PSP, Amiga…), finds your own BIOS anywhere by checksum; consoles with no legal BIOS stay out of the way |

## Library

| Feature | RetroArch | EmulatorJS | RomM | LaunchBox | ES-DE/EmuDeck | Batocera | **Phosphor** |
|---|---|---|---|---|---|---|---|
| Dedicated ROM folder layout | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ created for you, other frontends' folder names understood |
| Sort games for you | ❌ | ❌ | ❌ | import wizard | ❌ | ❌ | ⭐ drop anything anywhere; console worked out from extension, header, zip contents, checksum (tested) |
| Upload from the browser | — | ❌ | ✅ | — | — | web manager | ✅ drag and drop files or whole folders onto the window |
| Game identification | CRC scan | ❌ | hash + scrapers | scrapers | scrapers | scrapers | ✅ No-Intro/Redump/FBNeo checksums, disc serials, file names (offline, no account) |
| Box art, snaps, title screens | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ automatic, no account |
| Descriptions, videos, manuals | ❌ | ❌ | ✅ (API keys) | ✅ | ✅ | ✅ | ✅ descriptions free from Wikipedia (tested on real titles); ScreenScraper adds ratings, gameplay videos, manuals (tested against a mock) |
| Region variants collapsed | ❌ | ❌ | partial | ✅ | ❌ | ❌ | ✅ pick USA/Europe/Japan first |
| Multi-disc games | write .m3u | ❌ | ✅ | ✅ | write .m3u | write .m3u | ⭐ grouped automatically (tested), swap disc from the menu |
| ROM patches (translations, hacks) | ✅ softpatch | ❌ | ❌ | ❌ | via RetroArch | via RetroArch | ⭐ drop the .ips/.bps/.ups anywhere; it finds its game and applies on load (tested) |
| Renamed/moved files keep history | ❌ | — | ❌ | ❌ | ❌ | ❌ | ⭐ re-linked by checksum (tested) |
| Collections / favorites / search | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ shelves, favorites, instant search, "Surprise me" |
| Free games out of the box | ❌ | ❌ | ❌ | ❌ | ❌ | some | ⭐ 12 free games incl. Freedoom 1 and 2 and three Dreamcast games, one click (tested) |

## Playing

| Feature | RetroArch | EmulatorJS | RomM | LaunchBox | ES-DE/EmuDeck | Batocera | **Phosphor** |
|---|---|---|---|---|---|---|---|
| Save states | ✅ | ✅ | ✅ | via emulator | via emulator | ✅ | ⭐ 8 slots with screenshots, stored on the server (tested) |
| Resume where you left off | ✅ auto-save | ❌ | partial | ❌ | ❌ | ✅ | ⭐ on any device; Home shows the exact frame you quit on (tested) |
| In-game saves across devices | ❌ | ❌ browser only | ✅ upload | ❌ | paid (EmuDeck Cloud) | ❌ | ⭐ automatic sync, last 8 versions kept, one-click restore (tested) |
| Rewind / fast forward / slow motion | ✅ | ✅ | via EmulatorJS | via emulator | via RetroArch | ✅ | ✅ (slow motion tested: 54 → 20 fps) |
| Cheats | ✅ | ✅ | via EmulatorJS | via emulator | via RetroArch | ✅ | ✅ saved per game (tested) |
| Shaders / filters | ✅ | ✅ | via EmulatorJS | via emulator | via RetroArch | ✅ | ✅ pixel perfect, smooth, CRT, curved CRT, LCD; remembered per console |
| Screenshots | ✅ | ✅ download | ❌ | ❌ | ❌ | ✅ | ✅ saved as PNG files, gallery on the game page (tested) |
| Video recording | ✅ | ✅ download | ❌ | ❌ | ❌ | ✅ | ✅ clips with sound, saved to the server (tested) |
| Controllers | autoconfig | ✅ | via EmulatorJS | ✅ | ✅ | ✅ | ✅ plug and play, remappable |
| Phone as controller | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⭐ scan a QR code, up to 4 phones, per-console layouts (tested) |
| Touch controls on phone | ✅ overlays | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Online multiplayer (netplay) | ✅ | experimental | ❌ | via RetroArch | via RetroArch | ✅ | ❌ the web engine's netplay is still experimental |
| RetroAchievements | ✅ | ❌ | ✅ (display) | ✅ | ✅ | ✅ | partial: each player links their account and sees every game's achievements and progress (tested against a mock); earning needs an emulator RetroAchievements has approved |
| Run-ahead (input lag) | ✅ | ❌ | ❌ | via emulator | via RetroArch | ✅ | ❌ |
| Bezels / overlays | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |

## Interface and family

| Feature | RetroArch | EmulatorJS | RomM | LaunchBox | ES-DE/EmuDeck | Batocera | **Phosphor** |
|---|---|---|---|---|---|---|---|
| TV / couch mode with controller | ✅ | ❌ | ❌ | Big Box | ✅ | ✅ | ✅ whole UI, with button hints (tested) |
| Works on phone | ✅ app | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ same app, mobile layout |
| Player profiles | ❌ | ❌ | ✅ accounts | ❌ | ❌ | ❌ | ⭐ each with saves, resume points, favorites, stats |
| Kid mode / parental controls | ❌ | ❌ | ❌ | ✅ | ✅ kid mode | ❌ | ✅ allowed consoles per kid, parent PIN to leave (tested) |
| Play stats | partial | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ time per game/console, 30-day chart, streaks |
| Attract mode / screensaver | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ (tested) |
| Themes | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | partial: one design whose colours follow each console and game |

## Known gaps, honestly

- **Netplay**: needs support inside the browser emulator engine (EmulatorJS), which only has an
  experimental version. Phone controllers cover local multiplayer.
- **Earning RetroAchievements**: RetroAchievements only accepts unlocks from emulators it has
  approved, and rejects others (`unsupported_client`). Phosphor shows achievements and progress;
  earning them in Phosphor itself needs RetroAchievements' approval.
- **ScreenScraper** needs developer credentials that ScreenScraper issues per app.
- **Copyrighted BIOS files**: never included (see `bios/README.md`).
- **N64 and PSP** run in software in the browser, so they need a decent PC or recent phone; PSP and
  DOS also need the HTTPS address.
