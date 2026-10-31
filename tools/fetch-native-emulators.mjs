// Downloads the newest desktop emulators (Flycast, Dolphin, ...) for one OS into vendor/native, using
// the same code as the in-app Update button. The desktop build ships that folder inside the app.
//
//   node tools/fetch-native-emulators.mjs              this computer's OS
//   node tools/fetch-native-emulators.mjs win32        build the Windows set (from any OS)
//
// macOS disk images (.dmg) can only be unpacked on a Mac; elsewhere those emulators are skipped and
// the Mac build fetches them itself (the release workflow runs this on each OS).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeEmulators } from "../server/native/manager.js";
import { NATIVE, NATIVE_IDS, latestRelease } from "../server/native/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.argv[2] || process.platform;
const dir = path.join(root, "vendor", "native");
fs.rmSync(dir, { recursive: true, force: true }); // only one OS's emulators per build
const n = new NativeEmulators({ bundledDir: dir, userDir: null, platform, log: console });
let failed = 0;
for (const id of NATIVE_IDS) {
  if (!n.supported(id)) { console.log(`- ${NATIVE[id].name}: no ${platform} build`); continue; }
  const rel = await latestRelease(NATIVE[id], platform);
  if (rel.file.toLowerCase().endsWith(".dmg") && process.platform !== "darwin") { console.log(`- ${NATIVE[id].name} ${rel.version}: .dmg needs a Mac, skipped`); continue; }
  try {
    const m = await n.install(id, rel, { root: dir, onProgress: (msg) => console.log(`  ${msg}`) });
    console.log(`✓ ${NATIVE[id].name} ${m.version} → ${m.exe}`);
  } catch (e) {
    console.error(`✗ ${NATIVE[id].name}: ${e.message}`);
    failed++;
  }
}
if (failed) process.exit(1);
