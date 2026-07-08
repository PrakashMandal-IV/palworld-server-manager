// lib/ue4ss.js
// Manage UE4SS (Unreal Engine Scripting System) and its Lua mods on a Palworld
// dedicated server. This is a SEPARATE system from Palworld's official Steam Workshop
// mods (see lib/mods.js): UE4SS is a third-party framework that injects and runs Lua
// script mods at runtime.
//
// Layout on a dedicated server (Windows):
//   <install>/Pal/Binaries/Win64/
//     dwmapi.dll                 <- UE4SS injector
//     ue4ss/                     <- UE4SS runtime + UE4SS-settings.ini
//     Mods/
//       mods.txt                 <- load order + enable flags:  "ModName : 1"
//       <ModName>/
//         enabled.txt            <- optional: force-load regardless of mods.txt
//         Scripts/main.lua
//
// Critical for dedicated servers: UE4SS-settings.ini must have GuiConsoleVisible=0,
// otherwise UE4SS tries to open a console window and the server crashes on launch.
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

function win64Dir(installDir) { return path.join(installDir, "Pal", "Binaries", "Win64"); }
function ue4ssDir(installDir) { return path.join(win64Dir(installDir), "ue4ss"); }

// The Lua mods folder moved between UE4SS versions:
//   UE4SS 3.0+ : <Win64>/ue4ss/Mods   (everything but dwmapi.dll lives under ue4ss/)
//   older      : <Win64>/Mods
// Resolve to whichever actually exists; if neither does yet, pick based on whether the
// 3.0-style ue4ss/ folder is present (fresh 3.0 installs create it on extract).
function modsDir(installDir) {
  const modern = path.join(ue4ssDir(installDir), "Mods");
  const legacy = path.join(win64Dir(installDir), "Mods");
  if (fs.existsSync(modern)) return modern;
  if (fs.existsSync(legacy)) return legacy;
  return fs.existsSync(ue4ssDir(installDir)) ? modern : legacy;
}
function modsTxtPath(installDir) { return path.join(modsDir(installDir), "mods.txt"); }

// UE4SS-settings.ini has lived in a couple of places across versions.
function settingsIniPath(installDir) {
  const candidates = [
    path.join(ue4ssDir(installDir), "UE4SS-settings.ini"),
    path.join(win64Dir(installDir), "UE4SS-settings.ini"),
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return candidates[0];
}

// ---- detection ----
function detect(installDir) {
  const w64 = win64Dir(installDir);
  const win64Exists = fs.existsSync(w64);
  const dll = win64Exists && fs.existsSync(path.join(w64, "dwmapi.dll"));
  const runtime = win64Exists && (fs.existsSync(ue4ssDir(installDir)) || fs.existsSync(path.join(w64, "UE4SS.dll")));
  const installed = !!(dll || runtime);
  const gui = readGuiConsoleVisible(installDir);
  return {
    win64Exists,
    installed,
    hasInjector: dll,
    hasRuntime: runtime,
    guiConsoleVisible: gui,          // true is UNSAFE on a dedicated server
    guiConsoleSafe: gui === false,   // explicitly 0
    settingsPath: fs.existsSync(settingsIniPath(installDir)) ? settingsIniPath(installDir) : null,
  };
}

// Returns true/false if the setting is present, or null if unknown.
function readGuiConsoleVisible(installDir) {
  try {
    const p = settingsIniPath(installDir);
    if (!fs.existsSync(p)) return null;
    const m = fs.readFileSync(p, "utf8").match(/^\s*GuiConsoleVisible\s*=\s*(\d+)/im);
    if (!m) return null;
    return m[1] !== "0";
  } catch { return null; }
}

// Force GuiConsoleVisible=0 so the server doesn't crash trying to open a console.
function ensureGuiConsoleDisabled(installDir) {
  const p = settingsIniPath(installDir);
  if (!fs.existsSync(p)) return false;
  let raw = fs.readFileSync(p, "utf8");
  if (/^\s*GuiConsoleVisible\s*=/im.test(raw)) {
    raw = raw.replace(/^(\s*GuiConsoleVisible\s*=\s*)\d+/im, "$10");
  } else {
    raw += `${raw.endsWith("\n") ? "" : "\n"}GuiConsoleVisible=0\n`;
  }
  fs.writeFileSync(p, raw, "utf8");
  return true;
}

// ---- install ----
// Install UE4SS from a user-provided zip. The zip is the official UE4SS release the
// user downloaded (we don't redistribute or auto-download it). We locate the payload
// root inside the archive (the folder that contains dwmapi.dll), extract it into
// Win64, then force GuiConsoleVisible=0.
function install(installDir, zipPath) {
  const w64 = win64Dir(installDir);
  if (!fs.existsSync(w64)) throw new Error("Server binaries folder not found (Pal/Binaries/Win64). Point the world at a valid PalServer install first.");
  if (!fs.existsSync(zipPath)) throw new Error("UE4SS zip not found: " + zipPath);

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  // find the injector to determine the archive's payload root
  const dllEntry = entries.find((e) => /(^|\/)dwmapi\.dll$/i.test(e.entryName.replace(/\\/g, "/")));
  if (!dllEntry) throw new Error("This zip doesn't look like UE4SS (no dwmapi.dll inside). Download the UE4SS release zip and try again.");
  const dllNorm = dllEntry.entryName.replace(/\\/g, "/");
  const root = dllNorm.includes("/") ? dllNorm.slice(0, dllNorm.lastIndexOf("/")) : "";

  let extracted = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const norm = e.entryName.replace(/\\/g, "/");
    if (root && !norm.startsWith(root + "/")) continue;
    const rel = root ? norm.slice(root.length + 1) : norm;
    if (!rel) continue;
    const outPath = path.join(w64, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, e.getData());
    extracted++;
  }
  if (extracted === 0) throw new Error("Nothing was extracted from the UE4SS zip.");

  fs.mkdirSync(modsDir(installDir), { recursive: true });
  const guiFixed = ensureGuiConsoleDisabled(installDir);
  const d = detect(installDir);
  return { installed: d.installed, extracted, guiConsoleDisabled: guiFixed || d.guiConsoleSafe };
}

// ---- mods.txt read/write ----
// Returns a Map of modName -> enabled(boolean) and the raw ordered list.
function readModsTxt(installDir) {
  const p = modsTxtPath(installDir);
  const order = [];
  const state = new Map();
  if (!fs.existsSync(p)) return { order, state };
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith(";")) continue;
    const m = t.match(/^(.+?)\s*:\s*(\d+)\s*$/);
    if (!m) continue;
    const name = m[1].trim();
    order.push(name);
    state.set(name, m[2] !== "0");
  }
  return { order, state };
}

function writeModsTxt(installDir, order, state) {
  fs.mkdirSync(modsDir(installDir), { recursive: true });
  let out = "";
  for (const name of order) out += `${name} : ${state.get(name) ? 1 : 0}\n`;
  fs.writeFileSync(modsTxtPath(installDir), out, "utf8");
}

// ---- list mods ----
// Reconcile folders on disk with mods.txt. A mod is a Win64/Mods/<Name> folder that
// contains Scripts/main.lua (Lua mod) or dlls (Cpp mod). enabled.txt force-loads it.
const RESERVED = new Set(["shared", "BPModLoaderMod"]); // UE4SS internals, hidden from UI
function listMods(installDir) {
  const md = modsDir(installDir);
  if (!fs.existsSync(md)) return [];
  const { state } = readModsTxt(installDir);
  const out = [];
  for (const entry of fs.readdirSync(md, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (RESERVED.has(entry.name)) continue;
    const dir = path.join(md, entry.name);
    const hasLua = fs.existsSync(path.join(dir, "Scripts", "main.lua"));
    const forced = fs.existsSync(path.join(dir, "enabled.txt"));
    const inTxt = state.has(entry.name);
    const enabled = forced || (inTxt ? state.get(entry.name) : false);
    out.push({ name: entry.name, hasLua, forcedByEnabledTxt: forced, listedInModsTxt: inTxt, enabled });
  }
  return out;
}

// ---- enable / disable ----
// Toggle via mods.txt. If a mod is force-enabled by enabled.txt, disabling also removes
// that file (otherwise UE4SS would keep loading it regardless of mods.txt).
function setModEnabled(installDir, name, enabled) {
  const { order, state } = readModsTxt(installDir);
  if (!order.includes(name)) order.push(name);
  state.set(name, !!enabled);
  writeModsTxt(installDir, order, state);
  const enabledTxt = path.join(modsDir(installDir), name, "enabled.txt");
  if (!enabled && fs.existsSync(enabledTxt)) {
    try { fs.unlinkSync(enabledTxt); } catch {}
  }
  return listMods(installDir);
}

// ---- import a Lua mod zip ----
// Accepts a zip containing a mod folder (with Scripts/main.lua). Extracts it into
// Win64/Mods/<ModName> and registers it (disabled) in mods.txt.
function importModZip(installDir, zipPath) {
  if (!fs.existsSync(win64Dir(installDir))) throw new Error("Server binaries folder not found (Pal/Binaries/Win64).");
  if (!fs.existsSync(zipPath)) throw new Error("Mod zip not found: " + zipPath);
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  // find Scripts/main.lua to locate the mod's root folder and derive its name
  const luaEntry = entries.find((e) => /(^|\/)Scripts\/main\.lua$/i.test(e.entryName.replace(/\\/g, "/")));
  if (!luaEntry) throw new Error("Not a UE4SS Lua mod (no Scripts/main.lua found in the zip).");
  const luaNorm = luaEntry.entryName.replace(/\\/g, "/");
  // .../<ModName>/Scripts/main.lua  -> modRoot = .../<ModName>
  const modRoot = luaNorm.slice(0, luaNorm.toLowerCase().lastIndexOf("/scripts/main.lua"));
  const modName = (modRoot.includes("/") ? modRoot.slice(modRoot.lastIndexOf("/") + 1) : modRoot) || "LuaMod";
  const safeName = modName.replace(/[^a-zA-Z0-9_.-]/g, "_");

  const dest = path.join(modsDir(installDir), safeName);
  fs.mkdirSync(dest, { recursive: true });
  let extracted = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const norm = e.entryName.replace(/\\/g, "/");
    if (modRoot && !norm.startsWith(modRoot + "/")) continue;
    const rel = modRoot ? norm.slice(modRoot.length + 1) : norm;
    if (!rel) continue;
    const outPath = path.join(dest, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, e.getData());
    extracted++;
  }
  if (extracted === 0) throw new Error("Nothing was extracted from the mod zip.");

  // register in mods.txt as disabled by default
  const { order, state } = readModsTxt(installDir);
  if (!order.includes(safeName)) order.push(safeName);
  if (!state.has(safeName)) state.set(safeName, false);
  writeModsTxt(installDir, order, state);

  return { name: safeName, files: extracted };
}

// ---- remove a mod ----
function removeMod(installDir, name) {
  const dir = path.join(modsDir(installDir), name);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const { order, state } = readModsTxt(installDir);
  const nextOrder = order.filter((n) => n !== name);
  state.delete(name);
  writeModsTxt(installDir, nextOrder, state);
  return listMods(installDir);
}

// Combined status for the UI.
function status(installDir) {
  return { ...detect(installDir), mods: listMods(installDir) };
}

module.exports = {
  win64Dir, modsDir, modsTxtPath, ue4ssDir, settingsIniPath,
  detect, ensureGuiConsoleDisabled, install,
  readModsTxt, writeModsTxt, listMods, setModEnabled, importModZip, removeMod, status,
};
