// Exposes a few desktop-only actions to the web UI (the same UI runs in browsers without them).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("phosphorDesktop", {
  library: () => ipcRenderer.invoke("phosphor:library"),
  openFolder: (sub) => ipcRenderer.invoke("phosphor:open-folder", sub),
  chooseLibrary: () => ipcRenderer.invoke("phosphor:choose-library"),
});
