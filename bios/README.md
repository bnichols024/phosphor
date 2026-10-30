# Included BIOS files

Phosphor ships only BIOS files whose authors let anyone redistribute them:

| File | System | What it is | License |
|---|---|---|---|
| `openbios.bin` | PlayStation | OpenBIOS from the PCSX-Redux project (https://github.com/pcsx-redux/nugget, commit 3eda5af), an open-source PlayStation BIOS. Built from source with a MIPS cross compiler; loaded as `scph5501.bin`, the name the emulator looks for | MIT (`LICENSE-openbios.txt`) |
| `gba_bios.bin` | Game Boy Advance | Cult-of-GBA BIOS, an open-source replacement written from scratch by DenSinH and fleroviux (https://github.com/Cult-of-GBA/BIOS) | MIT (`LICENSE-cult-of-gba.txt`) |

Every other console either needs no BIOS or uses the replacement built into its emulator:
DeSmuME (Nintendo DS), Yabause (Saturn), PPSSPP (PSP), PUAE's AROS
Kickstart (Amiga), a5200 (Atari 5200), VICE, Fuse and Caprice32 (their system ROMs ship with the
emulators).

Official BIOS dumps from Sony, Nintendo, Sega and others are copyrighted, so they are never
included. If you own them, drop them into the library's BIOS folder (or anywhere in the drop
folder or ROM folders): Phosphor recognises them by checksum and uses them automatically, which
unlocks Sega CD, TurboGrafx-CD, 3DO, ColecoVision and Atari Lynx and improves compatibility for
PlayStation, DS, Saturn and GBA.
