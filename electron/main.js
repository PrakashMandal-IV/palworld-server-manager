// electron/main.js
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, Tray, nativeImage } = require("electron");
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
let tray = null;

// Set the moment a real quit is requested (tray Quit, or before-quit) so the window's
// close handler knows to actually close instead of hiding to the tray.
let quitting = false;

// True when the app was launched at login rather than opened by hand — used to start
// straight to the tray without a window (feature: autostart to tray). Set in main().
let launchedHidden = false;

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
    // A second launch (e.g. clicking the shortcut again) reveals the running app,
    // creating the window if it started to the tray.
    showWindow();
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
        // --hidden makes the login launch start straight to the tray (no window). A
        // manual launch from the menu carries no such flag, so it opens normally.
        const entry = [
          "[Desktop Entry]",
          "Type=Application",
          "Name=Palworld Server Manager",
          `Exec="${exe}" --hidden`,
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
  // args:["--hidden"] so the login launch starts to the tray; openAsHidden covers the
  // platforms that honour it. A hand-launched copy gets neither and opens a window.
  try { app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled, args: ["--hidden"] }); } catch (e) { logToFile(`setLoginItemSettings failed: ${e.message}`); }
}

function initAutostart() {
  let enabled = readAutostartPref();
  if (enabled === null) {
    enabled = true; // fresh install, or an upgrade that predates this setting
    writeAutostartPref(enabled);
  }
  applyAutostart(enabled);
}

// ---------------------------------------------------------------------------
// CLOSE TO TRAY — when on (the default), the window's close button hides the app
// to the system tray instead of quitting, so servers keep running in the
// background. Off makes the close button quit as before. Persisted next to the
// other launcher prefs so it survives updates.
// ---------------------------------------------------------------------------
function closeToTrayConfigPath() {
  return path.join(dataDir(), "closetotray.json");
}
function readCloseToTrayPref() {
  try {
    const v = JSON.parse(fs.readFileSync(closeToTrayConfigPath(), "utf8")).enabled;
    return typeof v === "boolean" ? v : true;
  } catch {
    return true; // default on
  }
}
function writeCloseToTrayPref(enabled) {
  try { fs.writeFileSync(closeToTrayConfigPath(), JSON.stringify({ enabled: !!enabled })); }
  catch (e) { logToFile(`Failed to persist close-to-tray pref: ${e.message}`); }
}

// ---------------------------------------------------------------------------
// SYSTEM TRAY — a persistent icon whose menu opens the app, jumps straight to a
// specific world, or quits. On Linux tray support depends on a StatusNotifier
// host (libappindicator); if creating it throws, we swallow it and carry on
// without a tray rather than failing to launch.
// ---------------------------------------------------------------------------
function trayIconPath() {
  const base = isDev
    ? path.join(__dirname, "..", "public")
    : path.join(process.resourcesPath, "app", "public");
  // .ico carries the multiple sizes Windows' tray wants; PNG elsewhere.
  return path.join(base, process.platform === "win32" ? "icon.ico" : "icon.png");
}

// Pull the world list from the local server for the tray menu. DB-only endpoint, so
// it's cheap to call on every menu refresh. Never rejects — a failure yields [].
function fetchWorlds() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/tray`, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        try { const j = JSON.parse(data); resolve(Array.isArray(j.worlds) ? j.worlds : []); }
        catch { resolve([]); }
      });
    });
    req.on("error", () => resolve([]));
    req.setTimeout(1500, () => { req.destroy(); resolve([]); });
  });
}

// Show the main window (creating it if the app started to the tray), optionally
// navigating to a specific world first.
function showWindow(worldId) {
  if (!serverReady) return;
  if (!mainWindow) createWindow();
  const win = mainWindow;
  if (!win) return;
  const go = () => {
    if (worldId) {
      const base = isDev ? process.env.ELECTRON_START_URL : `http://127.0.0.1:${PORT}`;
      win.loadURL(`${base}/worlds/${encodeURIComponent(worldId)}`);
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  // A window created just now isn't ready to navigate yet; wait for first paint.
  if (win.webContents.isLoading() && worldId) win.webContents.once("did-finish-load", go);
  else go();
}

async function refreshTrayMenu() {
  if (!tray) return;
  const worlds = await fetchWorlds();
  const worldItems = worlds.length
    ? worlds.map((w) => ({
        label: `${w.running ? "● " : "○ "}${w.display_name}`,
        click: () => showWindow(w.world_id),
      }))
    : [{ label: "No worlds yet", enabled: false }];

  const menu = Menu.buildFromTemplate([
    { label: "Open Palworld Server Manager", click: () => showWindow() },
    { type: "separator" },
    { label: "Worlds", enabled: false },
    ...worldItems,
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  if (tray) return true;
  try {
    let img = nativeImage.createFromPath(trayIconPath());
    if (img.isEmpty()) img = nativeImage.createEmpty();
    tray = new Tray(img);
    tray.setToolTip("Palworld Server Manager");
    // Left-click opens the app (Windows/Linux convention); the menu is right-click.
    tray.on("click", () => showWindow());
    refreshTrayMenu();
    // Keep the world list (names, running dots) current without the window open.
    setInterval(() => { refreshTrayMenu().catch(() => {}); }, 20000);
    return true;
  } catch (e) {
    logToFile(`Tray unavailable: ${e.message}`);
    tray = null;
    return false;
  }
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

  // Don't auto-show when we launched straight to the tray — the window is built so a
  // tray click has something to reveal, but it stays hidden until asked for.
  mainWindow.once("ready-to-show", () => { if (!launchedHidden) mainWindow.show(); });

  // Close-to-tray: unless a real quit is underway (or the pref is off, or there's no
  // tray to hide into), the close button hides the window and leaves the app running.
  mainWindow.on("close", (e) => {
    if (!quitting && tray && readCloseToTrayPref()) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
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

    // Did we launch at login (autostart-to-tray) rather than by hand? The .desktop /
    // login-item pass --hidden; Windows also reports it via getLoginItemSettings.
    launchedHidden = process.argv.includes("--hidden");
    try {
      const li = app.getLoginItemSettings();
      if (li.wasOpenedAtLogin || li.wasOpenedAsHidden) launchedHidden = true;
    } catch {}

    startNextServer();
    const url = isDev ? process.env.ELECTRON_START_URL : `http://127.0.0.1:${PORT}`;
    serverReady = await waitForServer(url);

    if (!serverReady) {
      // A broken server is worth surfacing even on a hidden launch — otherwise the app
      // is silently dead in the tray.
      showErrorWindow("The bundled web server did not respond within 60 seconds. This usually means a file is missing from the install or a security tool blocked it.");
      return;
    }

    const hasTray = createTray();
    // Show a window on a normal launch. On a hidden (login) launch, stay in the tray —
    // but only if we actually have a tray to live in; without one, fall back to showing
    // the window so the app is never both invisible and unreachable.
    if (!launchedHidden || !hasTray) createWindow();

    // On macOS, re-create the window when the dock icon is clicked — but ONLY
    // if there truly is no window AND the server is up. This is the guarded
    // version that prevents the infinite-window cascade.
    app.on("activate", () => {
      if (!mainWindow && serverReady) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    // With close-to-tray on, the window hides rather than closes, so this never fires
    // and the app keeps running in the tray. It only fires when the window genuinely
    // closes (close-to-tray off, or no tray) — which is a real quit.
    if (nextProc) { try { nextProc.kill(); } catch {} }
    app.quit();
  });

  app.on("before-quit", () => {
    quitting = true;
    if (tray) { try { tray.destroy(); } catch {} tray = null; }
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
ipcMain.handle("get-close-to-tray", () => readCloseToTrayPref());
ipcMain.handle("set-close-to-tray", (_e, enabled) => {
  writeCloseToTrayPref(!!enabled);
  return !!enabled;
});
