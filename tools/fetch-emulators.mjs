// Downloads the newest EmulatorJS runtime and every core into vendor/emulators, using the same code
// as the in-app Update button. Run at image build time so the app works offline out of the box.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Emulators } from "../server/emulators.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "vendor", "emulators");
const emu = new Emulators({ bundledDir: null, userDir: dir, log: console });
let last = "";
emu.onProgress((s) => {
  const line = `${s.phase} ${s.done}/${s.total} ${s.message}`;
  if (line !== last) { console.log(line); last = line; }
});
const res = await emu.update({ force: process.argv.includes("--force") });
console.log(res.updated ? `installed ${emu.active().id}` : "already up to date");
