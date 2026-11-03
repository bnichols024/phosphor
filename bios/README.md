# Included BIOS files

Phosphor ships only BIOS files whose authors let anyone redistribute them:

| File | System | What it is | License |
|---|---|---|---|
| `openbios.bin` | PlayStation | OpenBIOS from the PCSX-Redux project (https://github.com/pcsx-redux/nugget, commit 3eda5af), an open-source PlayStation BIOS. Built from source with a MIPS cross compiler; loaded as `scph5501.bin`, the name the emulator looks for | MIT (`LICENSE-openbios.txt`) |
| `gba_bios.bin` | Game Boy Advance | Cult-of-GBA BIOS, an open-source replacement written from scratch by DenSinH and fleroviux (https://github.com/Cult-of-GBA/BIOS) | MIT (`LICENSE-cult-of-gba.txt`) |
| `xbox_hdd.qcow2.zip` | Xbox (desktop app) | A blank, formatted Xbox hard drive with no copyrighted content, from the xemu project (https://github.com/xemu-project/xemu-hdd-image). Each player gets their own copy for saves | Published by the xemu project as copyright-free |
| `retroarch/tos.img` | Atari ST (desktop app) | EmuTOS 1.4, 192 KB US build (`etos192us.img`), a free TOS replacement (https://emutos.sourceforge.io). A player's own TOS of the same name is used instead when present | GPL-2.0+ (`LICENSE-emutos.txt`) |
| `retroarch/Machines/*C-BIOS*`, `retroarch/Databases` | MSX (desktop app) | C-BIOS 0.23 (https://cbios.sourceforge.net), a free MSX/MSX2/MSX2+ BIOS for cartridge games, with blueMSX's machine settings and game databases, taken from libretro's blueMSX system pack. Only the C-BIOS machines are kept: the pack's other machines contain manufacturers' copyrighted ROMs | BSD-2-Clause (`LICENSE-cbios.txt`); blueMSX data GPL |

Every other console either needs no BIOS or uses the replacement built into its emulator:
DeSmuME (Nintendo DS), Yabause (Saturn), PPSSPP (PSP), PUAE's AROS
Kickstart (Amiga), a5200 (Atari 5200), VICE, Fuse and Caprice32 (their system ROMs ship with the
emulators), and in the desktop app vecx (Vectrex), PokeMini (Pokémon mini) and Atari800, whose
built-in Altirra OS replaces Atari's.

Official BIOS dumps from Sony, Nintendo, Sega and others are copyrighted, so they are never
included. If you own them, drop them into the library's BIOS folder (or anywhere in the drop
folder or ROM folders): Phosphor recognises them by checksum and uses them automatically, which
unlocks Sega CD, TurboGrafx-CD, 3DO, ColecoVision and Atari Lynx (and in the desktop app
Intellivision, Odyssey², Channel F, Famicom Disk System and Neo Geo CD) and improves compatibility
for PlayStation, DS, Saturn and GBA.

The desktop app's PS2, Switch and Xbox emulators need files from your own console (PS2 BIOS, Switch
keys, Xbox MCPX and flash BIOS), and PS3 and PS Vita need Sony's system software, which Sony gives
away on its website but doesn't allow others to redistribute. Drop those into the BIOS folder and
Phosphor finds and uses them; it never downloads or ships them.
