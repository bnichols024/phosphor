// Starts a game in a desktop emulator and keeps track of it: one game at a time, play time
// recorded when the emulator closes, and a clear message if it quits straight away.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { NATIVE } from "./catalog.js";

// A macOS .app is a folder; the program inside is Contents/MacOS/<CFBundleExecutable>.
export function programPath(exe) {
  if (!exe.endsWith(".app")) return exe;
  const plist = (() => { try { return fs.readFileSync(path.join(exe, "Contents", "Info.plist"), "utf8"); } catch { return ""; } })();
  const name = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  const dir = path.join(exe, "Contents", "MacOS");
  if (name && fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  const first = fs.readdirSync(dir).find((f) => !f.startsWith("."));
  return path.join(dir, first);
}

export class NativeRunner {
  constructor({ native, onStart = () => {}, onExit = () => {}, log = console, spawnFn = spawn, quickExit = 5 }) {
    this.quickExit = quickExit; // seconds: closing sooner than this means it never really started
    this.native = native;
    this.onStart = onStart;
    this.onExit = onExit;
    this.log = log;
    this.spawn = spawnFn;
    this.current = null;
  }

  status() {
    const c = this.current;
    return c ? { running: true, gameId: c.gameId, emulator: c.emulator, startedAt: c.startedAt } : { running: false, last: this.last || null };
  }

  // emulatorId, game (absolute path), saveDir (player's save folder), dataDir (emulator settings),
  // sysFiles (the player's BIOS/keys/firmware paths for this console), system (the console's id,
  // for emulators that play several), biosFiles (its BIOS files as found: [{ name, file }]).
  // configure: open the emulator's own settings window instead of a game (no play time recorded).
  async start({ emulatorId, game, saveDir, dataDir, gameId = null, profileId, sysFiles = null, system = null, biosFiles = null, graphics = null, configure = false, onStep = () => {} }) {
    if (this.current || this.preparing) throw Object.assign(new Error(`${NATIVE[(this.current || this.preparing).emulator].name} is already running a game. Close it first.`), { status: 409 });
    const emu = NATIVE[emulatorId];
    const exe = this.native.exePath(emulatorId);
    if (!exe) throw Object.assign(new Error(`${emu.name} isn't installed. Open Settings › Emulators and press Update.`), { status: 503 });
    fs.mkdirSync(saveDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    const program = programPath(exe);
    const ctx = { game, saveDir, dataDir, platform: this.native.platform, sysFiles, system, biosFiles, program, graphics };
    if (configure && !emu.configure) throw Object.assign(new Error(`${emu.name} has no settings window to open.`), { status: 400 });
    this.preparing = { emulator: emulatorId };
    let args, env;
    try {
      // One-time setup some emulators need (installing Sony's system software), run to completion.
      for (const step of (await emu.prepare?.(ctx)) || []) {
        onStep(step.message);
        this.log.info?.(`native: ${emu.name} ${step.args.join(" ")}`);
        const code = await this._runOnce(program, step.args, { ...process.env, ...(step.env || {}) });
        if (code !== 0) throw Object.assign(new Error(`${emu.name} couldn't finish setting up (${step.message.replace(/…$/, "")}).`), { status: 500 });
        fs.writeFileSync(step.marker, new Date().toISOString());
      }
      ({ args, env } = await (configure ? emu.configure(ctx) : emu.launch(ctx)));
    } finally { this.preparing = null; }
    const child = this.spawn(program, args, {
      cwd: path.dirname(program),
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: false,
    });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr = (stderr + d).slice(-4000); });
    const run = { child, gameId, profileId, emulator: emulatorId, startedAt: Date.now(), program, args, configure };
    this.current = run;
    this.log.info?.(`native: ${emu.name} started for game ${gameId}`);
    const finish = (code, error) => {
      if (this.current !== run) return;
      this.current = null;
      const seconds = Math.round((Date.now() - run.startedAt) / 1000);
      // Closing within a few seconds means it never really started. The exit code can't be trusted
      // for that: AppImage launchers report 0 even when the emulator inside crashed.
      const failed = !!error || (!run.stopped && !configure && seconds < this.quickExit);
      const message = failed ? `${emu.name} closed straight away${error ? ` (${error.message})` : ""}. ${stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300)}`.trim() : null;
      this.last = { gameId, emulator: emulatorId, seconds, code, failed, message, endedAt: Date.now() };
      this.log.info?.(`native: ${emu.name} closed after ${seconds}s (exit ${code})`);
      this.onExit({ ...this.last, profileId, session: run.session });
    };
    child.on("error", (e) => finish(null, e));
    child.on("exit", (code) => finish(code, null));
    this.onStart({ gameId, profileId, emulator: emulatorId });
    return { started: true, emulator: emu.name };
  }

  _runOnce(program, args, env) {
    return new Promise((resolve) => {
      const p = this.spawn(program, args, { cwd: path.dirname(program), env, stdio: ["ignore", "ignore", "ignore"] });
      const timer = setTimeout(() => p.kill(), 15 * 60 * 1000);
      p.on("error", () => { clearTimeout(timer); resolve(-1); });
      p.on("exit", (code) => { clearTimeout(timer); resolve(code); });
    });
  }

  stop() {
    if (!this.current) return false;
    this.current.stopped = true;
    this.current.child.kill();
    return true;
  }
}
