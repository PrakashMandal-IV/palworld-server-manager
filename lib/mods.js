// lib/mods.js
// Palworld native server-side mod management, per the official docs:
// https://docs.palworldgame.com/settings-and-operation/mod/
//
// How the official system works:
//   - Workshop mods live in <installDir>/Mods/Workshop/<anyFolder>/Info.json
//   - Mods are enabled in <installDir>/Mods/PalModSettings.ini:
//         [PalModSettings]
//         bGlobalEnableMod=true
//         ActiveModList=<PackageName>   (one line per mod; PackageName from Info.json)
//   - On restart the server deploys each active mod per its InstallRules and writes
//     Mods/ManagedMods/<PackageName>/InstallManifest.json
//   - A mod only runs on a dedicated server if Info.json InstallRule includes "IsServer": true
//   - Server-side mods are Windows-only.
//   - Launch arg -NoMods disables all mods.
//
// This module reads/writes PalModSettings.ini, scans the Workshop folder, parses
// each Info.json, and imports mod archives into the Workshop directory.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const dbm = require("./db");
const steamlib = require("./steamlibrary");
const { trashPath } = require("./trash");

// Persisted, machine-wide override for where Steam keeps its Workshop content.
// Set once (e.g. the user's Steam is on D:) and every Workshop-by-ID add reuses it.
const STEAM_LIB_SETTING = "steamLibraryPath";
function getSteamLibraryOverride() { return dbm.getSetting(STEAM_LIB_SETTING, null); }
function setSteamLibraryOverride(p) {
  const v = p && String(p).trim() ? String(p).trim() : null;
  dbm.setSetting(STEAM_LIB_SETTING, v);
  return v;
}

function modsRoot(installDir) { return path.join(installDir, "Mods"); }
function workshopDir(installDir) { return path.join(modsRoot(installDir), "Workshop"); }
function modSettingsPath(installDir) { return path.join(modsRoot(installDir), "PalModSettings.ini"); }

// ---- PalModSettings.ini read/write ----
// Parse strictly line by line, taking each value from only its own line. A prior
// regex read WorkshopRootDir with `\s*` after `=`, which matches newlines — so an
// empty `WorkshopRootDir=` swallowed the next line (`ConfigVersion=1.0`) and
// corrupted the file on the next write. ConfigVersion is preserved and round-tripped.
function readModSettings(installDir) {
  const p = modSettingsPath(installDir);
  if (!fs.existsSync(p))
    return { exists: false, globalEnable: false, activeMods: [], workshopRootDir: null, configVersion: null };
  const raw = fs.readFileSync(p, "utf8");
  let globalEnable = false, workshopRootDir = null, configVersion = null;
  const activeMods = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("[")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim(); // same line only — never spans a newline
    if (/^bGlobalEnableMod$/i.test(key)) globalEnable = /^true$/i.test(val);
    else if (/^ActiveModList$/i.test(key)) { if (val) activeMods.push(val); }
    else if (/^WorkshopRootDir$/i.test(key)) { if (val) workshopRootDir = val; }
    else if (/^ConfigVersion$/i.test(key)) { if (val) configVersion = val; }
  }
  return { exists: true, globalEnable, activeMods, workshopRootDir, configVersion };
}

function writeModSettings(installDir, { globalEnable, activeMods, workshopRootDir, configVersion }) {
  fs.mkdirSync(modsRoot(installDir), { recursive: true });
  let out = "[PalModSettings]\n";
  out += `bGlobalEnableMod=${globalEnable ? "True" : "False"}\n`;
  for (const pkg of activeMods) out += `ActiveModList=${pkg}\n`;
  out += `WorkshopRootDir=${workshopRootDir || ""}\n`;
  if (configVersion) out += `ConfigVersion=${configVersion}\n`;
  fs.writeFileSync(modSettingsPath(installDir), out, "utf8");
  return modSettingsPath(installDir);
}

// ---- Info.json parsing ----
// Real Palworld Info.json shape:
//   { "ModName":"...", "PackageName":"...", "Version":"...",
//     "InstallRule": [ { "Type":"Paks", "IsServer":true, "Targets":[...] }, ... ] }
// InstallRule is an ARRAY of per-target rules; a mod runs on a dedicated server if
// ANY rule opts in with IsServer:true. (Some hand-made mods use a single object, so
// we tolerate both.) The earlier code read InstallRule as an object and checked
// rule.IsServer — always undefined for the array form, so every mod was wrongly
// flagged "not a server mod".
function installRuleIsServer(rule) {
  const rules = Array.isArray(rule) ? rule : rule ? [rule] : [];
  return rules.some((r) => r && (r.IsServer === true || r.isServer === true));
}

function parseInfoJson(infoPath) {
  try {
    const j = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    const rule = j.InstallRule || j.InstallRules || [];
    return {
      packageName: j.PackageName || j.packageName || null,
      displayName: j.ModName || j.DisplayName || j.Name || j.PackageName || null,
      version: j.Version || j.version || null,
      isServer: installRuleIsServer(rule),
      workshopId: j.WorkshopId || j.workshopId || null,
      raw: j,
    };
  } catch (e) {
    return { packageName: null, error: e.message };
  }
}

// Workshop mods ship a preview image next to Info.json. Steam names it differently
// depending on how the item was packed, so accept the common spellings (and match
// case-insensitively — the Workshop is authored on Windows, but we compare exactly).
const THUMB_NAMES = ["thumbnail.png", "thumbnail.jpg", "thumbnail.jpeg", "preview.png", "preview.jpg", "preview.jpeg"];

// The mod's preview image inside `dir`, or null. Returns the file name as it exists
// on disk so callers can build a path that works on case-sensitive filesystems.
function findThumbnail(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const want of THUMB_NAMES) {
    const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === want);
    if (hit) return hit.name;
  }
  return null;
}

// A Workshop item's numeric id: Info.json wins, else the folder name when we named
// it after the id ourselves (copyFromWorkshopContent does exactly that).
function workshopIdOf(mod) {
  if (mod.workshopId) return String(mod.workshopId);
  return /^\d+$/.test(mod.folder) ? mod.folder : null;
}

// Scan the Workshop directory for installed mods (folders containing Info.json).
function scanWorkshop(installDir) {
  const wd = workshopDir(installDir);
  if (!fs.existsSync(wd)) return [];
  const found = [];
  for (const entry of fs.readdirSync(wd, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(wd, entry.name);
    const infoPath = path.join(dir, "Info.json");
    if (fs.existsSync(infoPath)) {
      const info = parseInfoJson(infoPath);
      found.push({ folder: entry.name, infoPath, dir, thumbnail: findThumbnail(dir), ...info });
    }
  }
  return found;
}

// Combined view: what's on disk (Workshop) reconciled with the active list.
function status(worldId) {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("World not found");
  const settings = readModSettings(world.install_dir);
  const onDisk = scanWorkshop(world.install_dir);
  const activeSet = new Set(settings.activeMods);
  const windowsOnlyWarning = os.platform() !== "win32";

  const mods = onDisk.map((m) => ({
    folder: m.folder,
    packageName: m.packageName,
    displayName: m.displayName || m.packageName || m.folder,
    version: m.version,
    isServer: m.isServer,
    workshopId: workshopIdOf(m),
    enabled: m.packageName ? activeSet.has(m.packageName) : false,
    infoError: m.error || null,
    // UI extras: preview image, this mod's own folder, and whether it carries Lua
    // scripts (the only kind we can force-run for a mod that skipped IsServer).
    hasThumbnail: !!m.thumbnail,
    dir: m.dir,
    hasLua: luaTargets(m.raw).length > 0,
  }));

  // active packages with no matching folder on disk (dangling)
  const diskPkgs = new Set(onDisk.map((m) => m.packageName).filter(Boolean));
  const dangling = settings.activeMods.filter((p) => !diskPkgs.has(p));

  return {
    globalEnable: settings.globalEnable,
    modsSettingsExists: settings.exists,
    workshopDir: workshopDir(world.install_dir),
    windowsOnlyWarning,
    mods,
    dangling,
    // Where we'll look for Steam Workshop content: the saved override (if any) and
    // the Steam libraries we auto-detected. Lets the UI show/clear the path.
    steamLibraryPath: getSteamLibraryOverride(),
    steamLibrariesDetected: steamlib.discoverLibraries(getSteamLibraryOverride()),
  };
}

// ---- UE4SS Lua-mod bridge ----
// The catch that makes Workshop *Lua* mods silently do nothing: Palworld deploys a
// Workshop Lua mod's scripts to <install>/Mods/NativeMods/UE4SS/Mods/<Name>, but the
// UE4SS we install/run lives at Pal/Binaries/Win64/ue4ss and only scans its own
// ue4ss/Mods folder — so it never loads them. We bridge the gap: when a Lua-type
// Workshop mod is enabled, copy its Lua target(s) from the Workshop folder into the
// running UE4SS's Mods/<PackageName> and force-load it with enabled.txt (exactly the
// hand-fix that was verified working). Pak-only mods (no Lua rule) are untouched —
// Palworld deploys those natively to ~WorkshopMods.
function luaTargets(rawInfo) {
  const rule = (rawInfo && (rawInfo.InstallRule || rawInfo.InstallRules)) || [];
  const rules = Array.isArray(rule) ? rule : [rule];
  const out = new Set();
  for (const r of rules) {
    if (r && String(r.Type).toLowerCase() === "lua") {
      for (const t of r.Targets || []) out.add(t);
    }
  }
  return [...out];
}

function bridgedLuaModDir(installDir, packageName) {
  const ue4ss = require("./ue4ss"); // lazy: avoid any require cycle
  const safe = String(packageName).replace(/[^a-zA-Z0-9_.-]/g, "_");
  return path.join(ue4ss.modsDir(installDir), safe);
}

// Copy a Lua-type mod's scripts into the UE4SS load path and force-load it. Returns
// true if it bridged a runnable mod (a Scripts/main.lua landed), false otherwise.
function bridgeLuaMod(installDir, folder, packageName, rawInfo) {
  const targets = luaTargets(rawInfo);
  if (!targets.length) return false;
  const srcRoot = path.join(workshopDir(installDir), folder);
  const dest = bridgedLuaModDir(installDir, packageName);
  fs.rmSync(dest, { recursive: true, force: true });
  for (const t of targets) {
    const rel = String(t).replace(/^\.\//, "").replace(/[\\/]+$/, ""); // "./Scripts" -> "Scripts"
    const from = path.join(srcRoot, rel);
    if (fs.existsSync(from)) copyDir(from, path.join(dest, path.basename(rel)));
  }
  if (!fs.existsSync(path.join(dest, "Scripts", "main.lua"))) {
    fs.rmSync(dest, { recursive: true, force: true }); // nothing runnable copied
    return false;
  }
  fs.writeFileSync(path.join(dest, "enabled.txt"), "", "utf8");
  return true;
}

function unbridgeLuaMod(installDir, packageName) {
  const dest = bridgedLuaModDir(installDir, packageName);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
}

// Toggle a mod's active state by editing ActiveModList.
//
// `force` enables a mod whose Info.json never opted into dedicated servers
// (no InstallRule with IsServer:true). Plenty of Workshop mods work fine on a server
// but simply shipped without server install instructions, and the only recourse was
// wiring them up by hand. Palworld's own deploy step skips those mods — but the Lua
// bridge below is ours, so a forced Lua mod still lands in the UE4SS load path and
// runs. Pak-only mods have no such escape hatch, hence the guard.
function setModEnabled(worldId, packageName, enabled, force = false) {
  const world = dbm.getWorld(worldId);
  const s = readModSettings(world.install_dir);
  if (enabled) {
    const m = scanWorkshop(world.install_dir).find((x) => x.packageName === packageName);
    if (m && !m.isServer && !force) {
      throw new Error(`${packageName} is not marked IsServer — enable it with force to run it anyway.`);
    }
  }
  let active = new Set(s.activeMods);
  if (enabled) active.add(packageName); else active.delete(packageName);
  writeModSettings(world.install_dir, {
    globalEnable: s.globalEnable || enabled, // enabling a mod implies global enable
    activeMods: [...active],
    workshopRootDir: s.workshopRootDir,
    configVersion: s.configVersion,
  });
  // Bridge/unbridge Lua-type mods so the running UE4SS actually loads them.
  try {
    const target = scanWorkshop(world.install_dir).find((m) => m.packageName === packageName);
    if (enabled && target) {
      if (bridgeLuaMod(world.install_dir, target.folder, packageName, target.raw))
        dbm.logEvent(worldId, "mod", `Bridged Lua mod ${packageName} into UE4SS load path`);
    } else if (!enabled) {
      unbridgeLuaMod(world.install_dir, packageName);
    }
  } catch (e) {
    dbm.logEvent(worldId, "mod", `Lua bridge warning for ${packageName}: ${e.message}`);
  }
  const forced = enabled && force ? " (forced — not marked IsServer)" : "";
  dbm.logEvent(worldId, "mod", `${enabled ? "Enabled" : "Disabled"} mod ${packageName}${forced} (restart to apply)`);
  return status(worldId);
}

// Set the global mod on/off switch.
function setGlobalEnable(worldId, on) {
  const world = dbm.getWorld(worldId);
  const s = readModSettings(world.install_dir);
  writeModSettings(world.install_dir, { globalEnable: on, activeMods: s.activeMods, workshopRootDir: s.workshopRootDir, configVersion: s.configVersion });
  dbm.updateWorld(worldId, { mods_enabled: on ? 1 : 0 });
  dbm.logEvent(worldId, "mod", `Global mods ${on ? "enabled" : "disabled"} (restart to apply)`);
  return status(worldId);
}

// Import a mod archive (zip) into Workshop/<folder>. The zip must contain an
// Info.json somewhere; we place its containing folder under Workshop.
function importModZip(worldId, zipPath) {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("World not found");
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const infoEntry = entries.find((e) => /(^|\/)Info\.json$/i.test(e.entryName.replace(/\\/g, "/")));
  if (!infoEntry) throw new Error("Archive has no Info.json — not a Workshop-style Palworld mod");

  // parse Info.json straight from the archive to get PackageName
  let info;
  try { info = JSON.parse(zip.readAsText(infoEntry)); } catch { throw new Error("Info.json is not valid JSON"); }
  const pkg = info.PackageName || info.packageName;
  if (!pkg) throw new Error("Info.json has no PackageName");
  const isServer = installRuleIsServer(info.InstallRule || info.InstallRules || []);

  // folder inside the zip that holds Info.json
  const infoPathNorm = infoEntry.entryName.replace(/\\/g, "/");
  const innerDir = infoPathNorm.includes("/") ? infoPathNorm.slice(0, infoPathNorm.lastIndexOf("/")) : "";

  const wd = workshopDir(world.install_dir);
  const destFolder = pkg.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const dest = path.join(wd, destFolder);
  fs.mkdirSync(dest, { recursive: true });

  // extract only the mod's own subtree, rebased to dest root
  for (const e of entries) {
    if (e.isDirectory) continue;
    const norm = e.entryName.replace(/\\/g, "/");
    if (innerDir && !norm.startsWith(innerDir + "/")) continue;
    const rel = innerDir ? norm.slice(innerDir.length + 1) : norm;
    const outPath = path.join(dest, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, e.getData());
  }

  // record in registry
  const id = crypto.randomUUID();
  dbm.insertMod({
    id, world_id: worldId, package_name: pkg,
    display_name: info.ModName || info.DisplayName || info.Name || pkg,
    workshop_id: info.WorkshopId || null,
    version: info.Version || null,
    source: "manual", folder: destFolder,
    is_server: isServer ? 1 : 0, enabled: 0, created_at: Date.now(),
  });

  dbm.logEvent(worldId, "mod", `Imported mod ${pkg}${isServer ? "" : " (⚠ not marked IsServer)"}`);
  return { packageName: pkg, folder: destFolder, isServer, version: info.Version || null };
}

// Register a Workshop mod by numeric ID. The user must have subscribed to /
// downloaded it in Steam first; we then locate it across every Steam library on
// the machine (any drive) and copy it into this world's Workshop folder.
//
// Resolution order: an explicit per-call path, then the saved machine-wide
// override, then auto-discovery via the Windows registry + libraryfolders.vdf.
// A path passed explicitly is remembered so the next add finds it automatically.
function copyFromWorkshopContent(worldId, workshopId, steamWorkshopPath) {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("World not found");

  const explicit = steamWorkshopPath && String(steamWorkshopPath).trim();
  const override = explicit || getSteamLibraryOverride();
  const { path: src, searched } = steamlib.resolveWorkshopItem(workshopId, override);
  if (!src) {
    const where = searched.length ? `\nLooked in:\n${searched.join("\n")}` : "";
    throw new Error(
      `Couldn't find Workshop item ${workshopId} on this PC. Subscribe to (or download) it in ` +
      `Steam first, or set your Steam library folder if Steam isn't on C:.${where}`
    );
  }
  // Remember a working explicit path so future adds resolve without re-entering it.
  if (explicit) { try { setSteamLibraryOverride(explicit); } catch { /* non-fatal */ } }

  const infoPath = path.join(src, "Info.json");
  if (!fs.existsSync(infoPath)) throw new Error("That workshop folder has no Info.json");
  const info = parseInfoJson(infoPath);
  const dest = path.join(workshopDir(world.install_dir), String(workshopId));
  copyDir(src, dest);
  const id = crypto.randomUUID();
  dbm.insertMod({
    id, world_id: worldId, package_name: info.packageName,
    display_name: info.displayName, workshop_id: String(workshopId),
    version: info.version, source: "workshop", folder: String(workshopId),
    is_server: info.isServer ? 1 : 0, enabled: 0, created_at: Date.now(),
  });
  dbm.logEvent(worldId, "mod", `Added workshop mod ${workshopId} (${info.packageName})`);
  return { packageName: info.packageName, workshopId, isServer: info.isServer };
}

// ---- Workshop update checking ----
// Steam keeps a subscribed item current on disk, but PSM copies it into the world's
// own Workshop folder — so once Steam refreshes an item, our copy is stale until we
// re-copy it. Compare the "Version" in each installed Info.json against the Version
// in Steam's copy of the same item, which is exactly the manual diff people were
// doing by hand. Returns one entry per installed mod; `reason` explains any mod we
// couldn't compare rather than silently calling it up to date.
function checkWorkshopUpdates(worldId) {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("World not found");
  const override = getSteamLibraryOverride();
  const out = [];
  for (const m of scanWorkshop(world.install_dir)) {
    const base = {
      folder: m.folder,
      packageName: m.packageName,
      displayName: m.displayName || m.packageName || m.folder,
      installedVersion: m.version || null,
      availableVersion: null,
      updateAvailable: false,
      workshopId: workshopIdOf(m),
    };
    // Mods imported from a .zip have no Workshop item behind them — nothing to check.
    if (!base.workshopId) { out.push({ ...base, reason: "not_workshop" }); continue; }
    const { path: src } = steamlib.resolveWorkshopItem(base.workshopId, override);
    // Subscribed in Steam? If Steam has no copy we can't say anything about it.
    if (!src) { out.push({ ...base, reason: "not_subscribed" }); continue; }
    const avail = parseInfoJson(path.join(src, "Info.json"));
    if (avail.error) { out.push({ ...base, reason: "bad_source_info" }); continue; }
    out.push({
      ...base,
      availableVersion: avail.version || null,
      // Only a real, readable Version on Steam's side can flag an update. Comparing
      // as strings is deliberate: mod authors version however they like, so "newer"
      // isn't well defined — "different from what we copied" is what matters.
      updateAvailable: !!(avail.version && avail.version !== m.version),
      reason: avail.version ? null : "no_source_version",
    });
  }
  return out;
}

// Re-copy one Workshop mod from Steam's current copy, preserving whether it was
// enabled. The folder is replaced wholesale so files the author deleted upstream
// don't linger behind and get loaded.
function updateWorkshopMod(worldId, folderOrPkg) {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("World not found");
  const m = scanWorkshop(world.install_dir).find((x) => x.folder === folderOrPkg || x.packageName === folderOrPkg);
  if (!m) throw new Error("Mod not found");
  const wsId = workshopIdOf(m);
  if (!wsId) throw new Error("That mod wasn't added from the Steam Workshop, so there's nothing to update it from.");
  const { path: src, searched } = steamlib.resolveWorkshopItem(wsId, getSteamLibraryOverride());
  if (!src) {
    const where = searched.length ? `\nLooked in:\n${searched.join("\n")}` : "";
    throw new Error(`Couldn't find Workshop item ${wsId} on this PC — subscribe to it in Steam first.${where}`);
  }

  const s = readModSettings(world.install_dir);
  const wasEnabled = !!(m.packageName && s.activeMods.includes(m.packageName));
  const fresh = parseInfoJson(path.join(src, "Info.json"));
  const from = m.version || "?";

  const dest = path.join(workshopDir(world.install_dir), m.folder);
  fs.rmSync(dest, { recursive: true, force: true });
  copyDir(src, dest);

  // A new version may rename its PackageName; carry the active-list entry across so
  // an enabled mod doesn't silently turn itself off (or dangle) after an update.
  if (wasEnabled && fresh.packageName && fresh.packageName !== m.packageName) {
    const active = s.activeMods.map((p) => (p === m.packageName ? fresh.packageName : p));
    writeModSettings(world.install_dir, { globalEnable: s.globalEnable, activeMods: active, workshopRootDir: s.workshopRootDir, configVersion: s.configVersion });
    try { unbridgeLuaMod(world.install_dir, m.packageName); } catch { /* best effort */ }
  }
  // Refresh the UE4SS bridge so the newly copied Lua scripts are what actually runs.
  if (wasEnabled && fresh.packageName) {
    try { bridgeLuaMod(world.install_dir, m.folder, fresh.packageName, fresh.raw); }
    catch (e) { dbm.logEvent(worldId, "mod", `Lua bridge warning for ${fresh.packageName}: ${e.message}`); }
  }
  // Keep the bookkeeping row in step with what's on disk (best effort — status() is
  // read from disk, so a miss here is cosmetic).
  try {
    const row = dbm.listMods(worldId).find((r) => r.folder === m.folder);
    if (row) dbm.updateMod(row.id, { version: fresh.version || null, package_name: fresh.packageName || row.package_name, is_server: fresh.isServer ? 1 : 0 });
  } catch { /* non-fatal */ }

  dbm.logEvent(worldId, "mod", `Updated workshop mod ${fresh.packageName || m.folder} ${from} → ${fresh.version || "?"} (restart to apply)`);
  return { packageName: fresh.packageName, folder: m.folder, from, to: fresh.version || null, wasEnabled };
}

// Absolute path to a mod's preview image, or null. Constrained to the world's own
// Workshop folder so a crafted `folder` can't read arbitrary files off disk.
function modThumbnailPath(worldId, folder) {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("World not found");
  const wd = workshopDir(world.install_dir);
  const dir = path.resolve(wd, String(folder));
  if (path.relative(wd, dir).startsWith("..") || path.isAbsolute(path.relative(wd, dir))) return null;
  const name = findThumbnail(dir);
  return name ? path.join(dir, name) : null;
}

// Remove a mod: disable it, delete its Workshop folder.
function removeMod(worldId, packageNameOrFolder) {
  const world = dbm.getWorld(worldId);
  const s = readModSettings(world.install_dir);
  const disk = scanWorkshop(world.install_dir);
  const target = disk.find((m) => m.packageName === packageNameOrFolder || m.folder === packageNameOrFolder);

  // remove from active list
  if (target?.packageName) {
    const active = s.activeMods.filter((p) => p !== target.packageName);
    writeModSettings(world.install_dir, { globalEnable: s.globalEnable, activeMods: active, workshopRootDir: s.workshopRootDir, configVersion: s.configVersion });
    // tear down any UE4SS bridge we created for a Lua-type mod
    try { unbridgeLuaMod(world.install_dir, target.packageName); } catch { /* best effort */ }
  }
  // delete folder — to the Recycle Bin / Trash, so an uninstall stays recoverable
  if (target?.folder) {
    const dir = path.join(workshopDir(world.install_dir), target.folder);
    if (fs.existsSync(dir)) trashPath(dir);
  }
  dbm.logEvent(worldId, "mod", `Removed mod ${packageNameOrFolder} (restart to apply)`);
  return status(worldId);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, item.name), d = path.join(dst, item.name);
    if (item.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

module.exports = {
  modsRoot, workshopDir, modSettingsPath,
  readModSettings, writeModSettings, parseInfoJson, scanWorkshop,
  status, setModEnabled, setGlobalEnable,
  importModZip, copyFromWorkshopContent, removeMod,
  checkWorkshopUpdates, updateWorkshopMod, modThumbnailPath,
  getSteamLibraryOverride, setSteamLibraryOverride,
};
