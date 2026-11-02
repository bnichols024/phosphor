// Phosphor desktop app: runs the same server as the self-hosted version on this computer and
// shows it in a window. Games load from localhost, which browsers treat as secure, so PSP and DOS
// work without any HTTPS setup.
//
// First launch shows Phosphor's own welcome screen (desktop/setup.html) to pick where games live;
// if the server can't start, the same page explains why and offers a way out.
import { app, BrowserWindow, shell, ipcMain, dialog, Menu, clipboard } from "electron";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");

if (!app.requestSingleInstanceLock()) app.quit();

// ---- settings and log ----
const configFile = () => path.join(app.getPath("userData"), "config.json");
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), "utf8")); } catch { return {}; }
}
function writeConfig(c) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(c, null, 2));
}
const suggestedLibrary = () => path.join(app.getPath("home"), "Phosphor");
const configuredLibrary = () => process.env.PHOSPHOR_LIBRARY || readConfig().library || null;

const logFile = () => path.join(app.getPath("userData"), "phosphor.log");
function logLine(...a) {
  const line = `${new Date().toISOString()} ${a.map((x) => (x instanceof Error ? x.stack || x.message : String(x))).join(" ")}\n`;
  try { fs.mkdirSync(path.dirname(logFile()), { recursive: true }); fs.appendFileSync(logFile(), line); } catch { /* nowhere to log */ }
}
process.on("uncaughtException", (e) => logLine("uncaught", e));
process.on("unhandledRejection", (e) => logLine("unhandled", e));

let win = null;
let server = null;
let lastError = null;

// ---- server ----
// The usual port keeps the app's saved preferences (they belong to the page's address); if
// something else already uses it, take the next free one.
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "0.0.0.0", () => s.close(() => resolve(true)));
  });
}
async function pickPort() {
  const want = Number(readConfig().port) || 47811;
  for (let p = want; p < want + 20; p++) if (await portFree(p)) return p;
  throw new Error(`Ports ${want}–${want + 19} are all in use by other programs.`);
}

async function startServer(root) {
  // Emulators ship inside the app (resources/emulators); updates go to the library folder.
  const bundled = app.isPackaged ? path.join(process.resourcesPath, "emulators") : path.join(appRoot, "vendor", "emulators");
  // On Windows a module path must be a file:// URL, not C:\...
  const { start, lanAddresses } = await import(pathToFileURL(path.join(appRoot, "server", "index.js")).href);
  const port = await pickPort();
  // Phones on the same Wi-Fi need this computer's network address for the controller QR code.
  const lan = lanAddresses()[0];
  if (lan) process.env.PHOSPHOR_PUBLIC_URL = `http://${lan}:${port}`;
  process.env.PHOSPHOR_DESKTOP = "1";
  // Desktop emulators (Dreamcast, GameCube, PS2...) ship in resources/native; updates go to this
  // computer's app-data folder, never to the library (which may be a network share).
  const native = {
    bundledDir: app.isPackaged ? path.join(process.resourcesPath, "native") : path.join(appRoot, "vendor", "native"),
    userDir: path.join(app.getPath("userData"), "native"),
    // The emulator opens full screen on top; when it closes, Phosphor comes back to the front.
    onExit: () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      if (process.platform === "darwin") app.focus({ steal: true });
      win.focus();
    },
  };
  server = await start({ root, port, host: "0.0.0.0", bundledEmulators: bundled, native });
  return server.port;
}

// A folder Phosphor can actually use: create it and prove we can write there.
function checkFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.phosphor-write-test-${process.pid}`);
  fs.writeFileSync(probe, "ok");
  fs.rmSync(probe, { force: true });
}

const setupPage = (mode) => win.loadFile(path.join(here, "setup.html"), { query: { mode } });

async function launch() {
  const root = configuredLibrary();
  if (!root) return setupPage("welcome");
  try {
    checkFolder(root);
    const port = server?.port || await startServer(root);
    lastError = null;
    await win.loadURL(`http://localhost:${port}/`);
  } catch (e) {
    logLine("start failed", e);
    lastError = { message: e.message, folder: root, details: `${e.stack || e.message}\n\nPhosphor ${app.getVersion()} on ${process.platform} ${process.arch}\nLibrary: ${root}\nLog: ${logFile()}` };
    if (server) { await server.close().catch(() => {}); server = null; }
    setupPage("error");
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: "#06070b",
    show: false,
    title: "Phosphor",
    icon: path.join(appRoot, "desktop", "icons", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());
  // Links to other sites open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const local = /^http:\/\/localhost:\d+\//.test(url);
    if (!local) shell.openExternal(url);
    return { action: local ? "allow" : "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (/^https?:\/\//.test(url) && !/^http:\/\/localhost:\d+\//.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  win.on("enter-full-screen", () => win.setMenuBarVisibility(false));
}

// ---- welcome / error screen bridge ----
// Picking an existing folder puts a "Phosphor" folder inside it, unless it already is one.
const libraryIn = (picked) => (path.basename(picked).toLowerCase() === "phosphor" ? picked : path.join(picked, "Phosphor"));

ipcMain.handle("setup:info", () => ({
  suggested: suggestedLibrary(), library: configuredLibrary(), error: lastError,
  version: app.getVersion(), platform: process.platform,
}));
ipcMain.handle("setup:choose", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Choose where Phosphor keeps your games", properties: ["openDirectory", "createDirectory"], defaultPath: app.getPath("home") });
  return r.canceled || !r.filePaths[0] ? null : libraryIn(r.filePaths[0]);
});
ipcMain.handle("setup:use", async (_e, folder) => {
  try { checkFolder(folder); } catch (e) {
    return { error: `Phosphor can't use that folder (${e.code === "EACCES" || e.code === "EPERM" ? "it isn't allowed to write there" : e.message}). Choose another one.` };
  }
  writeConfig({ ...readConfig(), library: folder });
  await launch();
  return { ok: !lastError, error: lastError?.message || null };
});
ipcMain.handle("setup:retry", () => launch());
ipcMain.handle("setup:copy", (_e, text) => clipboard.writeText(String(text || "")));
ipcMain.handle("setup:open-log", () => shell.showItemInFolder(logFile()));
ipcMain.handle("setup:quit", () => app.quit());

// Desktop-only buttons in the app itself (open the library folder, move it).
ipcMain.handle("phosphor:library", () => configuredLibrary());
ipcMain.handle("phosphor:open-folder", (_e, sub) => shell.openPath(path.join(configuredLibrary() || suggestedLibrary(), sub || "")));
ipcMain.handle("phosphor:choose-library", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Choose where Phosphor keeps your games", properties: ["openDirectory", "createDirectory"], defaultPath: configuredLibrary() || app.getPath("home") });
  if (r.canceled || !r.filePaths[0]) return null;
  try { checkFolder(r.filePaths[0]); } catch { return null; }
  writeConfig({ ...readConfig(), library: r.filePaths[0] });
  app.relaunch();
  app.exit(0);
  return r.filePaths[0];
});

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }]));
  } else {
    Menu.setApplicationMenu(null);
  }
  createWindow();
  launch();
});
app.on("window-all-closed", async () => {
  await server?.close().catch(() => {});
  app.quit();
});
