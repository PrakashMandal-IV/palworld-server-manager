// electron/preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isElectron: true,
  pickDirectory: () => ipcRenderer.invoke("pick-directory"),
  pickZip: () => ipcRenderer.invoke("pick-zip"),
  getSystemTheme: () => ipcRenderer.invoke("get-theme"),
  getSystemLocale: () => ipcRenderer.invoke("get-system-locale"),
  openPath: (p) => ipcRenderer.invoke("open-path", p),
  getAutoLaunch: () => ipcRenderer.invoke("get-auto-launch"),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("set-auto-launch", enabled),
});
