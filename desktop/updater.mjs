// Phosphor's own updates, from the GitHub Releases page (the release workflow publishes there).
//
// Every platform checks the newest release itself (GitHub's API, no updater needed). Windows and
// Linux AppImages then download and install it in place through electron-updater. macOS can't:
// an unsigned app isn't allowed to replace itself, so Mac (and Linux .deb / .tar.gz) players get
// a Download button that opens the release page instead.
import { app, shell } from "electron";
import updaterPkg from "electron-updater";

const REPO = "bnichols024/phosphor";
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

// Newer if any of major.minor.patch is higher ("1.10.0" > "1.9.2"; a "v" prefix is ignored).
export function isNewer(latest, current) {
  const parts = (v) => String(v).replace(/^v/, "").split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parts(latest), parts(current)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function createUpdater({ send, log }) {
  // state: idle | checking | none | available | downloading | ready | error
  let state = { state: "idle", current: app.getVersion(), version: null, percent: 0, error: null, url: RELEASES, inApp: false };
  const set = (patch) => { state = { ...state, ...patch }; send(state); };
  const inApp = app.isPackaged && (process.platform === "win32" || (process.platform === "linux" && !!process.env.APPIMAGE));

  let auto = null;
  if (inApp) {
    auto = updaterPkg.autoUpdater;
    auto.autoDownload = false;
    auto.autoInstallOnAppQuit = true;
    auto.logger = { info: (m) => log("update:", m), warn: (m) => log("update warn:", m), error: (m) => log("update error:", m), debug: () => {} };
    auto.on("download-progress", (p) => set({ state: "downloading", percent: Math.round(p.percent || 0) }));
    auto.on("update-downloaded", (info) => set({ state: "ready", version: info.version || state.version, percent: 100 }));
    auto.on("error", (e) => set({ state: "error", error: friendly(e) }));
  }

  async function check({ quiet = false } = {}) {
    if (!app.isPackaged) return set({ state: "none", error: null });
    if (["downloading", "ready"].includes(state.state)) return state;
    if (!quiet) set({ state: "checking", error: null });
    try {
      // PHOSPHOR_UPDATE_API: a stand-in for GitHub's API, for testing.
      const r = await fetch(`${process.env.PHOSPHOR_UPDATE_API || "https://api.github.com"}/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": `Phosphor/${app.getVersion()}` } });
      if (r.status === 404) return set({ state: "none", error: null }); // no release published yet
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const rel = await r.json();
      const version = String(rel.tag_name || "").replace(/^v/, "");
      if (isNewer(version, app.getVersion())) set({ state: "available", version, url: rel.html_url || RELEASES, inApp, error: null });
      else set({ state: "none", version, error: null });
    } catch (e) {
      log("update check failed", e);
      if (quiet) set({ state: state.state === "checking" ? "idle" : state.state });
      else set({ state: "error", error: friendly(e) });
    }
    return state;
  }

  async function start() {
    if (state.state !== "available" && state.state !== "error") return state;
    if (!inApp) { shell.openExternal(state.url || RELEASES); return state; }
    set({ state: "downloading", percent: 0, error: null });
    try {
      await auto.checkForUpdates();
      await auto.downloadUpdate();
    } catch (e) {
      log("update download failed", e);
      set({ state: "error", error: friendly(e) });
    }
    return state;
  }

  function restart() {
    if (state.state === "ready" && auto) setImmediate(() => auto.quitAndInstall(false, true));
  }

  return {
    get state() { return state; },
    check, start, restart,
    openPage: () => shell.openExternal(state.url || RELEASES),
    // A first check shortly after start (so it doesn't slow the launch), then every few hours.
    schedule() {
      if (!app.isPackaged) return;
      setTimeout(() => check({ quiet: true }), 15000);
      setInterval(() => check({ quiet: true }), CHECK_EVERY).unref?.();
    },
  };
}

function friendly(e) {
  const m = String(e?.message || e || "");
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network|fetch failed/i.test(m)) return "Couldn't reach GitHub. Check your internet connection.";
  return m.split("\n")[0].slice(0, 200) || "Something went wrong.";
}
