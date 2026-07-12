// lib/backups.js  (spec §6)
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { P } = require("./paths");
const dbm = require("./db");
const rest = require("./restclient");
const { isRunning } = require("./supervisor");
const { notify } = require("./notify");

const BACKUP_DIR_SETTING = "backupDir";

function savedDir(world) {
  return path.join(world.install_dir, "Pal", "Saved");
}

// The user-chosen backup base, or "" when using the default under the data dir.
function getBackupDirOverride() {
  const v = dbm.getSetting(BACKUP_DIR_SETTING, "");
  return typeof v === "string" ? v.trim() : "";
}

// Where backups live right now (effective base path), plus whether it's a custom
// location and what the built-in default is — for display in the UI. Pass a worldId
// to also get that world's own backup subfolder (what the Backups panel opens).
function backupInfo(worldId) {
  const override = getBackupDirOverride();
  const def = P.defaultBackupsBase();
  const info = { path: override || def, custom: !!override, default: def };
  if (worldId) info.worldPath = path.join(override || def, String(worldId));
  return info;
}

// Point backups at a new folder. An empty/blank path resets to the default.
// Existing backups are left where they are; only new backups go to the new place.
function setBackupDir(p) {
  const clean = (p == null ? "" : String(p)).trim();
  if (!clean) { dbm.setSetting(BACKUP_DIR_SETTING, ""); return backupInfo(); }
  const resolved = path.resolve(clean);
  // Make sure we can actually create and write into it before saving the setting,
  // so a bad path fails loudly here instead of silently at the next backup.
  fs.mkdirSync(resolved, { recursive: true });
  const probe = path.join(resolved, ".psm-write-test");
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  dbm.setSetting(BACKUP_DIR_SETTING, resolved);
  return backupInfo();
}

async function createBackup(worldId, reason = "manual") {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("World not found");
  const saved = savedDir(world);
  if (!fs.existsSync(saved)) throw new Error("No Saved folder to back up yet");

  // stop-safe save if running with REST
  if (isRunning(worldId) && world.rest_api_enabled) {
    try { await rest.save(world); } catch {}
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `${worldId}-${stamp}`;
  const file = path.join(P.worldBackupDir(worldId, getBackupDirOverride()), `${stamp}.zip`);
  const zip = new AdmZip();
  zip.addLocalFolder(saved, "Saved");
  zip.writeZip(file);

  const size = fs.statSync(file).size;
  dbm.insertBackup({ id, world_id: worldId, file_path: file, size_bytes: size, reason, created_at: Date.now() });
  dbm.logEvent(worldId, "backup", `Backup created (${reason}, ${(size / 1e6).toFixed(1)} MB)`);
  // Announce real backups (manual + scheduled) to Discord. The internal safety
  // snapshots taken right before a restart/update/restore are skipped — they'd be
  // noise and would duplicate the restart/update notification that follows them.
  if (!String(reason).startsWith("pre-")) {
    await notify(worldId, "backup", `Backup created for ${world.display_name} (${reason}, ${(size / 1e6).toFixed(1)} MB)`);
  }
  rotate(worldId);
  return { id, file, size };
}

function rotate(worldId) {
  const keep = dbm.getSetting("backupRetention", 10);
  const rows = dbm.listBackups(worldId);
  if (rows.length <= keep) return;
  for (const r of rows.slice(keep)) {
    try { fs.unlinkSync(r.file_path); } catch {}
    dbm.deleteBackupRow(r.id);
  }
}

async function restoreBackup(worldId, backupId) {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("World not found");
  if (isRunning(worldId)) throw new Error("Stop the world before restoring");
  const row = dbm.listBackups(worldId).find((b) => b.id === backupId);
  if (!row || !fs.existsSync(row.file_path)) throw new Error("Backup file not found");

  // safety snapshot of current state first
  try { await createBackup(worldId, "pre-restore-safety"); } catch {}

  const saved = savedDir(world);
  if (fs.existsSync(saved)) fs.rmSync(saved, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(saved), { recursive: true });

  const zip = new AdmZip(row.file_path);
  // archive stores under "Saved/" → extract to install_dir/Pal
  zip.extractAllTo(path.join(world.install_dir, "Pal"), true);
  dbm.logEvent(worldId, "restore", `Restored backup ${backupId}`);
  return { restored: true };
}

module.exports = { createBackup, restoreBackup, rotate, savedDir, backupInfo, setBackupDir };
