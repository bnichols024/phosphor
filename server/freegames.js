// Free games: homebrew whose authors publish them for anyone to play. Phosphor doesn't ship the
// files; "Install" downloads them from the author's own release page into the right ROM folder.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { BY_ID } from "./systems.js";
import { listZip, readZipEntry } from "./lib/zip.js";

export const FREE_GAMES = [
  { id: "nova", title: "Nova the Squirrel", system: "nes", file: "Nova the Squirrel.nes", year: 2018, genre: "Platformer",
    url: "https://github.com/NovaSquirrel/NovaTheSquirrel/releases/download/v1.0.6a/nova.nes",
    author: "NovaSquirrel", license: "GPL-3.0", home: "https://github.com/NovaSquirrel/NovaTheSquirrel",
    blurb: "A squirrel who can copy enemies' powers, across 8 worlds of puzzles and platforming." },
  { id: "thwaite", title: "Thwaite", system: "nes", file: "Thwaite.nes", year: 2011, genre: "Action",
    url: "https://github.com/pinobatch/thwaite-nes/releases/download/v0.04/thwaite.nes",
    author: "Damian Yerrick", license: "GPL-3.0", home: "https://github.com/pinobatch/thwaite-nes",
    blurb: "Defend the town from incoming missiles in this Missile Command style shooter. Two players." },
  { id: "croom", title: "Concentration Room", system: "nes", file: "Concentration Room.nes", year: 2010, genre: "Puzzle",
    url: "https://github.com/pinobatch/croom-nes/releases/download/v0.02a/croom.nes",
    author: "Damian Yerrick", license: "GPL-3.0", home: "https://github.com/pinobatch/croom-nes",
    blurb: "A memory-match card game with a creepy lab twist. Play solo or against a friend." },
  { id: "libbet", title: "Libbet and the Magic Floor", system: "gb", file: "Libbet and the Magic Floor.gb", year: 2018, genre: "Puzzle",
    url: "https://github.com/pinobatch/libbet/releases/download/v0.08/libbet.gb",
    author: "Damian Yerrick", license: "Zlib", home: "https://github.com/pinobatch/libbet",
    blurb: "Roll across every tile of the magic floor without getting stuck. Simple to learn, hard to master." },
  { id: "ucity", title: "µCity", system: "gbc", file: "uCity.gbc", year: 2017, genre: "Simulation",
    url: "https://github.com/AntonioND/ucity/releases/download/v1.3/ucity.gbc",
    author: "Antonio Niño Díaz", license: "GPL-3.0 / CC BY-SA 4.0", home: "https://github.com/AntonioND/ucity",
    blurb: "A full city-building sim on the Game Boy Color: zoning, power, traffic, disasters and all." },
  { id: "ucity-advance", title: "µCity Advance", system: "gba", file: "uCity Advance.gba", year: 2021, genre: "Simulation",
    url: "https://github.com/AntonioND/ucity-advance/releases/download/v1.0.3/ucity-advance-v1.0.3.gba",
    author: "Antonio Niño Díaz", license: "GPL-3.0 / CC BY-SA 4.0", home: "https://github.com/AntonioND/ucity-advance",
    blurb: "The bigger Game Boy Advance version of µCity, with larger maps and more to build." },
  { id: "cave-story-md", title: "Cave Story", system: "genesis", file: "Cave Story (Mega Drive port).gen", year: 2025, genre: "Action adventure",
    url: "https://github.com/andwn/cave-story-md/releases/download/v0.8.8/doukutsu-en.gen",
    author: "andwn (port of Studio Pixel's freeware classic)", license: "Free, non-commercial", home: "https://github.com/andwn/cave-story-md",
    blurb: "The legendary indie action-adventure, rebuilt for the Sega Genesis. Free to play, not for sale." },
  { id: "demon-bazooka", title: "Demon Bazooka", system: "dreamcast", file: "Demon Bazooka.cdi", year: 2026, genre: "Shooter",
    url: "https://github.com/richstokes/dreamcast-homebrew/releases/latest/download/demon-bazooka.cdi",
    author: "Rich Stokes", license: "MIT", home: "https://github.com/richstokes/dreamcast-homebrew",
    blurb: "A fast 3D arena shooter: rockets, dashes and screen-clearing barrages against waves of demons. Plays in the desktop app." },
  { id: "gravity-wave", title: "Gravity Wave", system: "dreamcast", file: "Gravity Wave.cdi", year: 2026, genre: "Flight shooter",
    url: "https://github.com/richstokes/dreamcast-homebrew/releases/latest/download/gravity-wave.cdi",
    author: "Rich Stokes", license: "MIT", home: "https://github.com/richstokes/dreamcast-homebrew",
    blurb: "Endless 3D arcade flight over procedural terrain, with enemy formations, guardians and upgrades. Plays in the desktop app." },
  { id: "drift-la", title: "Drift Los Angeles", system: "dreamcast", file: "Drift Los Angeles.cdi", year: 2026, genre: "Racing",
    url: "https://github.com/richstokes/dreamcast-homebrew/releases/latest/download/drift-los-angeles.cdi",
    author: "Rich Stokes", license: "MIT", home: "https://github.com/richstokes/dreamcast-homebrew",
    blurb: "Open-city street drifting through four Los Angeles districts, with traffic, drift chains and tyre smoke. Plays in the desktop app." },
  { id: "freedoom1", title: "Freedoom: Phase 1", system: "doom", file: "Freedoom Phase 1.wad", year: 2024, genre: "First-person shooter",
    url: "https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip", unzip: "freedoom1.wad",
    author: "The Freedoom project", license: "BSD-3-Clause", home: "https://freedoom.github.io",
    blurb: "A complete, free four-episode shooter for the Doom engine: new monsters, weapons, music and 36 levels." },
  { id: "freedoom2", title: "Freedoom: Phase 2", system: "doom", file: "Freedoom Phase 2.wad", year: 2024, genre: "First-person shooter",
    url: "https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip", unzip: "freedoom2.wad",
    author: "The Freedoom project", license: "BSD-3-Clause", home: "https://freedoom.github.io",
    blurb: "32 more free levels in the style of Doom II, with the super shotgun and bigger, meaner monsters." },
];

export class FreeGames {
  constructor({ library, db, log = console }) {
    this.library = library;
    this.db = db;
    this.log = log;
    this.busy = new Set();
  }

  target(g) { return path.join(this.library.romsDir, BY_ID[g.system].folder, g.file); }

  list() {
    return FREE_GAMES.map((g) => {
      const rel = path.relative(this.library.root, this.target(g));
      const row = this.db.get("SELECT id FROM games WHERE path = ? AND missing_since IS NULL", rel);
      return { ...g, installed: fs.existsSync(this.target(g)), gameId: row?.id || null, installing: this.busy.has(g.id) };
    });
  }

  async install(id) {
    const g = FREE_GAMES.find((x) => x.id === id);
    if (!g) throw new Error("Unknown free game.");
    const dest = this.target(g);
    if (fs.existsSync(dest)) return { already: true };
    if (this.busy.has(id)) return { busy: true };
    this.busy.add(id);
    try {
      const res = await fetch(g.url, { signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      let buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error("download was empty");
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      const tmp = path.join(path.dirname(dest), `.dl-${crypto.randomBytes(4).toString("hex")}`);
      await fsp.writeFile(tmp, buf);
      if (g.unzip) {
        // Released as a zip: keep just the one file the game needs.
        const entry = (await listZip(tmp))?.find((e) => path.basename(e.name) === g.unzip);
        buf = entry && await readZipEntry(tmp, entry);
        if (!buf || buf.length !== entry.usize) { await fsp.rm(tmp, { force: true }); throw new Error(`${g.unzip} missing from the download`); }
        await fsp.writeFile(tmp, buf);
      }
      await fsp.rename(tmp, dest);
      this.log.info?.(`free games: installed ${g.title}`);
      return { installed: true };
    } finally {
      this.busy.delete(id);
    }
  }
}
