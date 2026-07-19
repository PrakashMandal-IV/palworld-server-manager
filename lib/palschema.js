// lib/palschema.js
// Manage PalSchema — a UE4SS framework that lets mods edit Palworld's data tables and
// blueprints from JSON without clobbering each other. It layers on top of UE4SS (see
// lib/ue4ss.js): the framework is a UE4SS mod, and its *content* mods (the kind published
// on Nexus, e.g. MelwenMods) drop into a `mods` folder inside it.
//
// Layout on a dedicated server (Windows binaries, run natively or via Wine):
//   <install>/Pal/Binaries/Win64/ue4ss/Mods/
//     mods.txt                       <- UE4SS load order; "PalSchema : 1" enables it
//     PalSchema/
//       (framework dll + files)
//       mods/                        <- one folder per PalSchema content mod (enabled)
//       mods-disabled/               <- our convention: disabled mods parked here
//
// PalSchema is MIT-licensed (https://github.com/Okaetsu/PalSchema), so we can fetch its
// release zip from GitHub on the user's behalf. A user-provided zip is also accepted for
// offline installs or pinning a specific version.
const fs = require("fs");
const path = require("path");
const https = require("https");
const AdmZip = require("adm-zip");
const { P } = require("./paths");
const ue4ss = require("./ue4ss");
const { trashPath } = require("./trash");

const REPO = "Okaetsu/PalSchema";
// UE4SS stock helper mods PalSchema needs enabled to load and run (per its install
// docs). We flip these on in mods.txt only if they already exist there — they ship
// with UE4SS, so we never invent entries, just make sure they're not left at 0.
const REQUIRED_UE4SS_MODS = [
  "BPModLoaderMod", "BPML_GenericFunctions", "BPMLGenericFunctions",
  "CheatManagerEnablerMod", "ConsoleCommandsMod", "ConsoleEnablerMod",
];

// ---- paths ----
function frameworkDir(installDir) { return path.join(ue4ss.modsDir(installDir), "PalSchema"); }
function modsDir(installDir) { return path.join(frameworkDir(installDir), "mods"); }
function disabledDir(installDir) { return path.join(frameworkDir(installDir), "mods-disabled"); }

// ---- detection ----
// PalSchema is installed when its framework folder exists inside the UE4SS Mods dir and
// carries real payload (a dll, or at least the `mods` folder it ships with). UE4SS must
// be present first — PalSchema is meaningless without it.
function detect(installDir) {
  const ue = ue4ss.detect(installDir);
  const fw = frameworkDir(installDir);
  let installed = false, hasDll = false;
  if (fs.existsSync(fw)) {
    try {
      const entries = fs.readdirSync(fw);
      hasDll = entries.some((e) => e.toLowerCase().endsWith(".dll"));
      installed = hasDll || entries.includes("mods");
    } catch { /* unreadable → treat as not installed */ }
  }
  return { ue4ssInstalled: ue.installed, installed, hasDll, path: installed ? fw : null };
}

// ---- content mods ----
function safeName(name) { return String(name).replace(/[^a-zA-Z0-9_.-]/g, "_"); }

// A folder contains pak/ucas/utoc assets → it's a "hybrid" mod that also ships packaged
// game assets, which PalSchema alone doesn't load. We still install the JSON part but
// flag it so the UI can warn.
function folderIsHybrid(dir) {
  let hybrid = false;
  const walk = (d) => {
    if (hybrid) return;
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (hybrid) return;
      if (it.isDirectory()) walk(path.join(d, it.name));
      else if (/\.(pak|ucas|utoc)$/i.test(it.name)) hybrid = true;
    }
  };
  walk(dir);
  return hybrid;
}

// Scan enabled (mods/) and disabled (mods-disabled/) folders → one entry per mod.
function listMods(installDir) {
  const out = [];
  const scan = (dir, enabled) => {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (!it.isDirectory()) continue;
      out.push({ name: it.name, enabled, hybrid: folderIsHybrid(path.join(dir, it.name)) });
    }
  };
  scan(modsDir(installDir), true);
  scan(disabledDir(installDir), false);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ---- zip helpers ----
// Normalized ("/"-separated) entry name.
function norm(entryName) { return entryName.replace(/\\/g, "/"); }

// Extract every archive entry under `prefix` into destDir, stripping the prefix. An
// empty prefix extracts the whole archive. Returns the count of files written.
function extractSubtree(zip, prefix, destDir) {
  let n = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const p = norm(e.entryName);
    if (prefix && !p.startsWith(prefix)) continue;
    const rel = prefix ? p.slice(prefix.length) : p;
    if (!rel) continue;
    const outPath = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, e.getData());
    n++;
  }
  return n;
}

// Top-level directory names and whether any meaningful file sits at the archive root.
function topLevel(zip) {
  const dirs = new Set();
  let rootFiles = 0;
  for (const e of zip.getEntries()) {
    const p = norm(e.entryName).replace(/^\.\//, "");
    if (!p || p === "/") continue;
    const slash = p.indexOf("/");
    if (slash === -1) { if (!e.isDirectory && !/readme|license|\.txt$/i.test(p)) rootFiles++; }
    else dirs.add(p.slice(0, slash));
  }
  return { dirs: [...dirs], rootFiles };
}

// ---- framework install ----
function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { "User-Agent": "palworld-server-manager", Accept: "application/vnd.github+json" }, timeout: 8000 },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.destroy(); return fetchLatestRelease().then(resolve, reject);
        }
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`GitHub ${res.statusCode} fetching PalSchema release`));
          try {
            const rel = JSON.parse(body);
            const assets = rel.assets || [];
            // Prefer an asset that names PalSchema; fall back to the first .zip.
            const asset = assets.find((a) => /palschema.*\.zip$/i.test(a.name)) || assets.find((a) => /\.zip$/i.test(a.name));
            if (!asset) return reject(new Error("No .zip asset on the latest PalSchema release"));
            resolve({ version: rel.tag_name || rel.name || "latest", url: asset.browser_download_url, name: asset.name });
          } catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timed out contacting GitHub for PalSchema")); });
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { "User-Agent": "palworld-server-manager" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) { file.close(); try { fs.unlinkSync(dest); } catch {} return reject(new Error(`Download failed (HTTP ${res.statusCode})`)); }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (e) => { try { fs.unlinkSync(dest); } catch {} reject(e); });
  });
}

// Enable PalSchema (and any present required UE4SS helper mods) in mods.txt. Adds a
// PalSchema entry if the file has none; leaves load order otherwise untouched.
function enableInModsTxt(installDir) {
  const { order, state } = ue4ss.readModsTxt(installDir);
  const newOrder = [...order];
  if (!state.has("PalSchema")) { newOrder.push("PalSchema"); }
  state.set("PalSchema", true);
  for (const m of REQUIRED_UE4SS_MODS) if (state.has(m)) state.set(m, true);
  ue4ss.writeModsTxt(installDir, newOrder, state);
}

// Install the framework from a zip (given path, or the latest GitHub release). Requires
// UE4SS already installed. Returns { installed, version, source }.
async function installFramework(installDir, { zipPath = null } = {}) {
  if (!ue4ss.detect(installDir).installed) {
    throw new Error("Install UE4SS first — PalSchema is a UE4SS mod and can't load without it.");
  }
  let source = "zip", version = null, tmp = null;
  if (!zipPath) {
    const rel = await fetchLatestRelease();
    version = rel.version; source = "github";
    tmp = path.join(P.staging(), `palschema-${Date.now()}.zip`);
    await download(rel.url, tmp);
    zipPath = tmp;
  }
  if (!fs.existsSync(zipPath)) throw new Error("PalSchema zip not found: " + zipPath);

  try {
    const zip = new AdmZip(zipPath);
    // Find the framework root inside the archive: the "PalSchema/" folder. Extract its
    // contents into <UE4SS Mods>/PalSchema. If the archive has no such folder, assume
    // its root already IS the PalSchema payload.
    let prefix = "";
    for (const e of zip.getEntries()) {
      const p = norm(e.entryName);
      const m = p.match(/(^|\/)PalSchema\//i);
      if (m) { prefix = p.slice(0, m.index + m[0].length); break; }
    }
    const dest = frameworkDir(installDir);
    const wrote = extractSubtree(zip, prefix, dest);
    if (wrote === 0) throw new Error("Nothing was extracted — is this a PalSchema zip?");
    fs.mkdirSync(modsDir(installDir), { recursive: true });
    enableInModsTxt(installDir);
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch {} }
  }

  const d = detect(installDir);
  return { installed: d.installed, version, source };
}

// ---- content mod import ----
// Import a PalSchema content mod from a zip into mods/<ModName>. If the zip wraps its
// files in a single top folder, that folder's name becomes the mod name; otherwise the
// zip's own base name is used. Returns { name, hybrid }.
function importMod(installDir, zipPath) {
  if (!detect(installDir).installed) throw new Error("Install the PalSchema framework first.");
  if (!fs.existsSync(zipPath)) throw new Error("Mod zip not found: " + zipPath);
  const zip = new AdmZip(zipPath);
  const { dirs, rootFiles } = topLevel(zip);

  let prefix = "", name;
  if (dirs.length === 1 && rootFiles === 0) {
    name = safeName(dirs[0]);
    prefix = dirs[0] + "/";
  } else {
    name = safeName(path.basename(zipPath).replace(/\.zip$/i, ""));
  }
  if (!name) throw new Error("Could not determine a mod name from the zip.");

  const dest = path.join(modsDir(installDir), name);
  // A re-import replaces the previous copy so stale files don't linger.
  try { if (fs.existsSync(dest)) trashPath(dest); } catch { fs.rmSync(dest, { recursive: true, force: true }); }
  const wrote = extractSubtree(zip, prefix, dest);
  if (wrote === 0) { fs.rmSync(dest, { recursive: true, force: true }); throw new Error("The zip had no files to install."); }
  // If it was disabled under this name before, clear the stale disabled copy.
  const disabledCopy = path.join(disabledDir(installDir), name);
  if (fs.existsSync(disabledCopy)) { try { trashPath(disabledCopy); } catch {} }
  return { name, hybrid: folderIsHybrid(dest) };
}

// Enable/disable by moving the mod folder between mods/ and mods-disabled/. PalSchema
// loads whatever sits in mods/, so parking a folder next door is how you turn it off
// without losing it.
function setModEnabled(installDir, name, enabled) {
  const safe = safeName(name);
  const from = path.join(enabled ? disabledDir(installDir) : modsDir(installDir), safe);
  const to = path.join(enabled ? modsDir(installDir) : disabledDir(installDir), safe);
  if (!fs.existsSync(from)) {
    // Already in the desired state (or missing) — nothing to do.
    if (fs.existsSync(to)) return listMods(installDir);
    throw new Error(`PalSchema mod not found: ${name}`);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.rmSync(to, { recursive: true, force: true });
  fs.renameSync(from, to);
  return listMods(installDir);
}

function removeMod(installDir, name) {
  const safe = safeName(name);
  const candidates = [path.join(modsDir(installDir), safe), path.join(disabledDir(installDir), safe)];
  let removed = false;
  for (const c of candidates) {
    if (fs.existsSync(c)) { trashPath(c); removed = true; }
  }
  if (!removed) throw new Error(`PalSchema mod not found: ${name}`);
  return listMods(installDir);
}

// ---- combined status for the UI ----
function status(installDir) {
  const d = detect(installDir);
  return {
    ue4ssInstalled: d.ue4ssInstalled,
    installed: d.installed,
    path: d.path,
    mods: d.installed ? listMods(installDir) : [],
  };
}

module.exports = {
  frameworkDir, modsDir, disabledDir,
  detect, status, listMods,
  fetchLatestRelease, installFramework,
  importMod, setModEnabled, removeMod,
};
