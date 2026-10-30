// Phosphor desktop app: runs the same server as the self-hosted version on this computer and
// shows it in a window. Games load from localhost, which browsers treat as secure, so PSP and DOS
// work without any HTTPS setup.
import { app, BrowserWindow, shell, ipcMain, dialog, Menu } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");

if (!app.requestSingleInstanceLock()) app.quit();

// Where the library lives: remembered in a small config file, defaulting to ~/Phosphor.
const configFile = () => path.join(app.getPath("userData"), "config.json");
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), "utf8")); } catch { return {}; }
}
function writeConfig(c) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(c, null, 2));
}
const libraryRoot = () => process.env.PHOSPHOR_LIBRARY || readConfig().library || path.join(app.getPath("home"), "Phosphor");

let win = null;
let server = null;

async function startServer() {
  // Emulators ship inside the app (resources/emulators); updates go to the library folder.
  const bundled = app.isPackaged ? path.join(process.resourcesPath, "emulators") : path.join(appRoot, "vendor", "emulators");
  const { start, lanAddresses } = await import(path.join(appRoot, "server", "index.js"));
  const port = Number(readConfig().port) || 47811;
  // Phones on the same Wi-Fi need this computer's network address for the controller QR code.
  const lan = lanAddresses()[0];
  if (lan) process.env.PHOSPHOR_PUBLIC_URL = `http://${lan}:${port}`;
  process.env.PHOSPHOR_DESKTOP = "1";
  server = await start({ root: libraryRoot(), port, host: "0.0.0.0", bundledEmulators: bundled });
  return server.port;
}

// First launch: ask where to create the games folder (ROMs/, Drop Games Here/, Saves/, BIOS/).
async function chooseLibraryOnFirstRun() {
  if (process.env.PHOSPHOR_LIBRARY || readConfig().library) return true;
  const suggested = path.join(app.getPath("home"), "Phosphor");
  const r = await dialog.showMessageBox({
    type: "question",
    title: "Welcome to Phosphor",
    message: "Where should Phosphor keep your games?",
    detail: `Phosphor will create a folder there with a place for every console, a "Drop Games Here" folder that sorts games for you, and your saves.\n\nSuggested: ${suggested}`,
    buttons: ["Use the suggested folder", "Choose a folder…", "Quit"],
    defaultId: 0,
    cancelId: 2,
  });
  if (r.response === 2) return false;
  let root = suggested;
  if (r.response === 1) {
    const pick = await dialog.showOpenDialog({ title: "Choose where Phosphor keeps your games", properties: ["openDirectory", "createDirectory"], defaultPath: app.getPath("home") });
    if (pick.canceled || !pick.filePaths[0]) return chooseLibraryOnFirstRun();
    // Picking an existing folder puts a "Phosphor" folder inside it, unless it already is one.
    root = path.basename(pick.filePaths[0]).toLowerCase() === "phosphor" ? pick.filePaths[0] : path.join(pick.filePaths[0], "Phosphor");
  }
  writeConfig({ ...readConfig(), library: root });
  return true;
}

async function createWindow() {
  if (!(await chooseLibraryOnFirstRun())) { app.quit(); return; }
  let port;
  try {
    port = await startServer();
  } catch (e) {
    dialog.showErrorBox("Phosphor couldn't start", `${e.message}\n\nIf another copy of Phosphor is running, close it and try again.`);
    app.quit();
    return;
  }
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: "#06070b",
    title: "Phosphor",
    icon: path.join(appRoot, "desktop", "icons", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.loadURL(`http://localhost:${port}/`);
  // Links to other sites open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${port}`)) shell.openExternal(url);
    return { action: url.startsWith(`http://localhost:${port}`) ? "allow" : "deny" };
  });
  win.on("enter-full-screen", () => win.setMenuBarVisibility(false));
}

// Small bridge for desktop-only buttons (open the library folder, move it).
ipcMain.handle("phosphor:library", () => libraryRoot());
ipcMain.handle("phosphor:open-folder", (_e, sub) => shell.openPath(path.join(libraryRoot(), sub || "")));
ipcMain.handle("phosphor:choose-library", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Choose where Phosphor keeps your games", properties: ["openDirectory", "createDirectory"], defaultPath: libraryRoot() });
  if (r.canceled || !r.filePaths[0]) return null;
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
});
app.on("window-all-closed", async () => {
  await server?.close().catch(() => {});
  app.quit();
});
