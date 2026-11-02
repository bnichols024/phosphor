// Exposes a few desktop-only actions to the web UI (the same UI runs in browsers without them),
// and the welcome/error screen's actions (desktop/setup.html).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("phosphorDesktop", {
  library: () => ipcRenderer.invoke("phosphor:library"),
  openFolder: (sub) => ipcRenderer.invoke("phosphor:open-folder", sub),
  chooseLibrary: () => ipcRenderer.invoke("phosphor:choose-library"),
});

contextBridge.exposeInMainWorld("phosphorSetup", {
  info: () => ipcRenderer.invoke("setup:info"),
  choose: () => ipcRenderer.invoke("setup:choose"),
  use: (folder) => ipcRenderer.invoke("setup:use", folder),
  retry: () => ipcRenderer.invoke("setup:retry"),
  copy: (text) => ipcRenderer.invoke("setup:copy", text),
  openLog: () => ipcRenderer.invoke("setup:open-log"),
  quit: () => ipcRenderer.invoke("setup:quit"),
});
