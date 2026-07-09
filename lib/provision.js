// lib/provision.js  (spec §2 provisioning, §3 import, §8 update, duplicate)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const { P } = require("./paths");
const dbm = require("./db");
const steam = require("./steamcmd");
const ini = require("./ini");
const jobs = require("./jobs");
const { suggestPorts } = require("./ports");
const { createBackup } = require("./backups");

// Job tracking is delegated to the shared registry (lib/jobs.js) so installs and
// updates surface together in the downloads tray. These thin wrappers keep the
// existing provision API (and /api/provision/status) working.
function newJob(worldId = null, worldName = "") {
  return jobs.createJob({ type: "install", worldId, worldName });
}
function jobLog(id, line) { jobs.logJob(id, line); }
function getJob(id) { return jobs.getJob(id); }

// Create a world profile record (no install yet).
function createProfile({ display_name, install_dir, ports, admin_password }) {
  const p = ports || suggestPorts();
  const world = {
    world_id: crypto.randomUUID(),
    display_name: display_name || "New World",
    install_dir,
    game_port: p.game_port,
    query_port: p.query_port,
    rest_api_port: p.rest_api_port,
    rcon_port: p.rcon_port,
    admin_password: admin_password || crypto.randomBytes(6).toString("hex"),
    rest_api_enabled: 1,
    status: "stopped",
    autostart: 0,
    crash_guard: 1,
    build_id: null,
    extra_args: "",
    created_at: Date.now(),
  };
  return dbm.insertWorld(world);
}

// Full provision: ensure steamcmd, install, bootstrap ini, capture build id.
async function provisionWorld(jobId, worldId) {
  const world = dbm.getWorld(worldId);
  const log = (l) => jobLog(jobId, l);
  try {
    if (world.display_name) jobs.setPhase(jobId, "starting", `Installing ${world.display_name}`);
    fs.mkdirSync(world.install_dir, { recursive: true });
    dbm.updateWorld(worldId, { status: "updating" });
    jobs.setProgress(jobId, null, "Preparing SteamCMD…");
    await steam.ensureSteamCmd(log);
    log(`Installing Palworld Dedicated Server (app ${steam.PALWORLD_APPID})...`);
    jobs.setPhase(jobId, "steamcmd", "Downloading server…");
    const res = await steam.installOrUpdate(world.install_dir, log);
    if (!res.ok) throw new Error(`SteamCMD failed (code ${res.code})`);

    // capture build id (verified install may already have it)
    const bid = res.buildId || steam.readInstalledBuildId(world.install_dir);
    if (bid) { dbm.updateWorld(worldId, { build_id: bid }); log(`Installed build ${bid}`); }

    // bootstrap ini from the shipped default, then apply this world's ports/password
    jobs.setPhase(jobId, "settings", "Writing server settings…");
    log("Writing server settings (ports, admin password, REST API)...");
    ini.applyWorldNetworkSettings(world.install_dir, dbm.getWorld(worldId));

    dbm.updateWorld(worldId, { status: "stopped" });
    dbm.logEvent(worldId, "provision", "Install complete");
    log("Done. World is ready to start.");
    jobs.finishJob(jobId, true, { worldId });
  } catch (e) {
    log(`ERROR: ${e.message}`);
    dbm.updateWorld(worldId, { status: "stopped" });
    jobs.finishJob(jobId, false, { worldId, error: e.message });
  }
}

// Register an already-installed server (no SteamCMD). Points a new profile at an
// existing install dir, captures its build id, and writes this world's own
// ports/password into its ini (preserving any existing settings/saves).
function adoptExistingInstall({ display_name, install_dir, ports, admin_password, keepExistingPassword }) {
  const detect = require("./detect");
  const info = detect.inspect(install_dir);
  if (!info.valid) throw new Error(info.reason || "Not a valid Palworld server install");

  const world = createProfile({
    display_name: display_name || info.serverName || "Existing World",
    install_dir: info.installDir,
    ports,
    admin_password,
  });

  // If the user wants to keep the server's current admin password, read it from ini.
  if (keepExistingPassword) {
    try {
      const s = ini.readSettings(info.installDir);
      const raw = s.options.AdminPassword;
      if (raw) {
        const pw = String(raw).replace(/^"|"$/g, "");
        if (pw) dbm.updateWorld(world.world_id, { admin_password: pw });
      }
    } catch {}
  }

  if (info.buildId) dbm.updateWorld(world.world_id, { build_id: info.buildId });

  // Apply this world's network identity into the existing ini (idempotent).
  try { ini.applyWorldNetworkSettings(info.installDir, dbm.getWorld(world.world_id)); } catch {}

  dbm.logEvent(world.world_id, "provision", `Adopted existing install (build ${info.buildId || "unknown"})`);
  return { world: dbm.getWorld(world.world_id), info };
}

// ---- Save import (spec §3) ----
function validateSaveZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().map((e) => e.entryName.replace(/\\/g, "/"));
  const hasIni = entries.some((e) => /Config\/(Windows|Linux)Server\/PalWorldSettings\.ini$/i.test(e));
  const hasLevel = entries.some((e) => /SaveGames\/.+\/Level\.sav$/i.test(e));
  const players = entries.filter((e) => /SaveGames\/.+\/Players\/.+\.sav$/i.test(e));
  const worldGuid = (() => {
    const m = entries.find((e) => /SaveGames\/[^/]+\/([^/]+)\/Level\.sav$/i.test(e));
    return m ? m.match(/SaveGames\/[^/]+\/([^/]+)\/Level\.sav$/i)[1] : null;
  })();
  return { valid: hasLevel || hasIni, hasIni, hasLevel, playerCount: players.length, worldGuid, entries };
}

// Import a validated save zip into a world's Saved folder.
async function importSave(worldId, zipPath, { backupFirst = true } = {}) {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("World not found");
  const check = validateSaveZip(zipPath);
  if (!check.valid) throw new Error("Zip does not contain a recognizable Palworld save (no Level.sav / settings ini)");

  const saved = path.join(world.install_dir, "Pal", "Saved");
  if (backupFirst && fs.existsSync(saved)) {
    try { await createBackup(worldId, "pre-import-safety"); } catch {}
  }

  // extract to staging first
  const stage = path.join(P.staging(), crypto.randomUUID());
  fs.mkdirSync(stage, { recursive: true });
  new AdmZip(zipPath).extractAllTo(stage, true);

  // find the Saved root inside staging (zip may wrap it)
  const savedRoot = findSavedRoot(stage);
  if (!savedRoot) { fs.rmSync(stage, { recursive: true, force: true }); throw new Error("Could not locate Saved contents in archive"); }

  if (fs.existsSync(saved)) fs.rmSync(saved, { recursive: true, force: true });
  fs.mkdirSync(saved, { recursive: true });
  copyDir(savedRoot, saved);
  fs.rmSync(stage, { recursive: true, force: true });

  // re-apply this world's own network settings (spec §3 step 6)
  ini.applyWorldNetworkSettings(world.install_dir, world);
  dbm.logEvent(worldId, "import", `Imported save (${check.playerCount} players, guid ${check.worldGuid || "?"})`);
  return check;
}

function findSavedRoot(dir) {
  // Look for a folder that directly contains "SaveGames" or "Config".
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    const items = fs.readdirSync(d, { withFileTypes: true });
    const names = items.filter((i) => i.isDirectory()).map((i) => i.name);
    if (names.includes("SaveGames") || names.includes("Config")) return d;
    for (const n of names) stack.push(path.join(d, n));
  }
  return null;
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
  newJob, getJob, jobLog, createProfile, provisionWorld, adoptExistingInstall,
  validateSaveZip, importSave, copyDir,
};
