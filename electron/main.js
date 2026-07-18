// electron/main.js
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const http = require("http");

const isDev = process.env.NODE_ENV === "development";
const PORT = 4317;
let mainWindow = null;
let nextProc = null;
let serverReady = false;

// ---------------------------------------------------------------------------
// PORTABLE MODE — keep everything next to the .exe, leaving no trace elsewhere.
// electron-builder's portable target sets PORTABLE_EXECUTABLE_DIR to the folder
// the portable .exe was launched from. When present, relocate Electron's whole
// userData tree (our SQLite DB, backups, SteamCMD, logs — plus Chromium's cache)
// into a "PSM-Data" folder beside the .exe, so the app is fully self-contained.
// The installed (NSIS) build has no such env var and keeps using %APPDATA%.
// This must run before app is ready and before anything reads a user path.
// ---------------------------------------------------------------------------
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const portableData = path.join(process.env.PORTABLE_EXECUTABLE_DIR, "PSM-Data");
  try { fs.mkdirSync(portableData, { recursive: true }); } catch {}
  try { app.setPath("userData", portableData); } catch {}
}

// ---------------------------------------------------------------------------
// SINGLE INSTANCE LOCK — prevents the "infinite windows" cascade.
// If a second copy launches, focus the existing window instead of spawning one.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  main();
}

function dataDir() {
  return app.getPath("userData");
}

function resourcePath() {
  // In a packaged app, the standalone server lives under resources/app.
  return path.join(process.resourcesPath, "app");
}

function logToFile(msg) {
  try {
    fs.appendFileSync(path.join(dataDir(), "launcher.log"), `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

// ---------------------------------------------------------------------------
// LAUNCH ON STARTUP — on by default, both for a fresh install and for anyone
// upgrading from a version that predates this setting (no persisted choice
// yet reads as "on"). Once the user picks a value in Settings it's persisted
// here and sticks across restarts and future updates.
//
// Windows uses Electron's own Run-key API. Linux has no Electron equivalent,
// so we manage a .desktop file under ~/.config/autostart ourselves. (No macOS
// build is shipped, so it's left untouched with a best-effort fallback.)
// ---------------------------------------------------------------------------
const LINUX_AUTOSTART_FILE = path.join(os.homedir(), ".config", "autostart", "com.palworld.servermanager.desktop");

function autostartConfigPath() {
  return path.join(dataDir(), "autostart.json");
}

function readAutostartPref() {
  try {
    const v = JSON.parse(fs.readFileSync(autostartConfigPath(), "utf8")).enabled;
    return typeof v === "boolean" ? v : null;
  } catch {
    return null; // never chosen yet
  }
}

function writeAutostartPref(enabled) {
  try { fs.writeFileSync(autostartConfigPath(), JSON.stringify({ enabled })); } catch (e) { logToFile(`Failed to persist autostart pref: ${e.message}`); }
}

function applyAutostart(enabled) {
  if (process.platform === "linux") {
    try {
      if (enabled) {
        fs.mkdirSync(path.dirname(LINUX_AUTOSTART_FILE), { recursive: true });
        // Prefer the original AppImage path (electron-builder sets $APPIMAGE at
        // launch) over process.execPath, which for an AppImage points at the
        // extracted runtime binary rather than the file the user actually has.
        const exe = process.env.APPIMAGE || process.execPath;
        const entry = [
          "[Desktop Entry]",
          "Type=Application",
          "Name=Palworld Server Manager",
          `Exec="${exe}"`,
          "X-GNOME-Autostart-enabled=true",
          "",
        ].join("\n");
        fs.writeFileSync(LINUX_AUTOSTART_FILE, entry);
      } else {
        fs.rmSync(LINUX_AUTOSTART_FILE, { force: true });
      }
    } catch (e) { logToFile(`Linux autostart update failed: ${e.message}`); }
    return;
  }
  // Windows (and, best-effort, any other platform): Electron owns this natively.
  try { app.setLoginItemSettings({ openAtLogin: enabled }); } catch (e) { logToFile(`setLoginItemSettings failed: ${e.message}`); }
}

function initAutostart() {
  let enabled = readAutostartPref();
  if (enabled === null) {
    enabled = true; // fresh install, or an upgrade that predates this setting
    writeAutostartPref(enabled);
  }
  applyAutostart(enabled);
}

function startNextServer() {
  if (isDev) return; // dev uses `next dev` started by the npm script

  const base = resourcePath();
  const serverPath = path.join(base, "server.js");

  if (!fs.existsSync(serverPath)) {
    logToFile(`server.js NOT FOUND at ${serverPath}`);
    return;
  }

  const env = {
    ...process.env,
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    PALWORLD_MANAGER_DATA_DIR: dataDir(),
    // Expose the installed app version to the server so the UI can check for updates.
    PALWORLD_APP_VERSION: app.getVersion(),
    // CRITICAL: make the Electron binary behave as plain Node for this child,
    // so it can run the Next standalone server.js.
    ELECTRON_RUN_AS_NODE: "1",
    // Use the pure-WASM SQLite backend, which needs no experimental flag and no
    // specific Node/Electron version — this is what makes the packaged app start
    // reliably regardless of the Electron-bundled Node version.
    PALWORLD_SQLITE_BACKEND: "wasm",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --no-warnings`.trim(),
  };

  nextProc = spawn(process.execPath, [serverPath], {
    env,
    cwd: base,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  nextProc.stdout.on("data", (d) => logToFile(`[next] ${d.toString().trim()}`));
  nextProc.stderr.on("data", (d) => logToFile(`[next:err] ${d.toString().trim()}`));
  nextProc.on("error", (e) => logToFile(`Next server spawn error: ${e.message}`));
  nextProc.on("exit", (code) => logToFile(`Next server exited: ${code}`));
}

function pingServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.destroy(); resolve(true); });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(url, maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await pingServer(url)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function createWindow() {
  if (mainWindow) { mainWindow.focus(); return; } // never create a second window

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: "#1e1f22",
    title: "Palworld Server Manager",
    autoHideMenuBar: true,   // hide File/Edit/View menu bar (Discord-like)
    icon: isDev
      ? path.join(__dirname, "..", "public", process.platform === "win32" ? "icon.ico" : "icon.png")
      : path.join(process.resourcesPath, "app", "public", process.platform === "win32" ? "icon.ico" : "icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Remove the application menu entirely (no File/Edit/Window bar).
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  const url = isDev ? process.env.ELECTRON_START_URL : `http://127.0.0.1:${PORT}`;
  mainWindow.loadURL(url);

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => (mainWindow = null));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function showErrorWindow(message) {
  if (mainWindow) return;
  mainWindow = new BrowserWindow({
    width: 720, height: 420, backgroundColor: "#1e1f22",
    autoHideMenuBar: true, title: "Palworld Server Manager",
  });
  Menu.setApplicationMenu(null);
  const html = `<!doctype html><html><body style="font-family:Segoe UI,system-ui,sans-serif;background:#1e1f22;color:#f2f3f5;padding:40px;line-height:1.6">
    <h2 style="color:#f2a53c">The manager couldn't start its local server</h2>
    <p>${message}</p>
    <p style="color:#949ba4;font-size:13px">A log was written to:<br><code>${path.join(dataDir(), "launcher.log")}</code></p>
    </body></html>`;
  mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  mainWindow.on("closed", () => (mainWindow = null));
}

function main() {
  app.whenReady().then(async () => {
    // Ensures Windows uses our icon (not the default Electron one) in the taskbar.
    if (process.platform === "win32") app.setAppUserModelId("com.palworld.servermanager");
    initAutostart();
    startNextServer();
    const url = isDev ? process.env.ELECTRON_START_URL : `http://127.0.0.1:${PORT}`;
    serverReady = await waitForServer(url);
    if (serverReady) createWindow();
    else showErrorWindow("The bundled web server did not respond within 60 seconds. This usually means a file is missing from the install or a security tool blocked it.");

    // On macOS, re-create the window when the dock icon is clicked — but ONLY
    // if there truly is no window AND the server is up. This is the guarded
    // version that prevents the infinite-window cascade.
    app.on("activate", () => {
      if (!mainWindow && serverReady) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (nextProc) { try { nextProc.kill(); } catch {} }
    app.quit(); // quit on all platforms (this is a single-window desktop tool)
  });

  app.on("before-quit", () => {
    if (nextProc) { try { nextProc.kill(); } catch {} }
  });
}

// ---- Native IPC: folder picker + file picker for the renderer ----
ipcMain.handle("pick-directory", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle("pick-zip", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Zip archives", extensions: ["zip"] }],
  });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle("get-theme", () => (nativeTheme.shouldUseDarkColors ? "dark" : "light"));
ipcMain.handle("get-system-locale", () => app.getLocale() || "en");
ipcMain.handle("open-path", (_e, p) => shell.openPath(p));
ipcMain.handle("get-auto-launch", () => {
  const v = readAutostartPref();
  return v === null ? true : v;
});
ipcMain.handle("set-auto-launch", (_e, enabled) => {
  writeAutostartPref(!!enabled);
  applyAutostart(!!enabled);
  return !!enabled;
});
