// lib/paths.js
// Centralizes where the app stores its data. In Electron the userData dir is
// injected via PALWORLD_MANAGER_DATA_DIR; in plain dev it falls back to ./.data.
const os = require("os");
const path = require("path");
const fs = require("fs");

function dataDir() {
  const injected = process.env.PALWORLD_MANAGER_DATA_DIR;
  const base = injected || path.join(process.cwd(), ".data");
  ensure(base);
  return base;
}

function ensure(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Backups can be redirected to a user-chosen folder (Settings → Backups). The
// override is stored as an app setting and passed in by lib/backups.js — paths.js
// stays free of a db dependency (which would be circular, since the db lives under
// dataDir()). A falsy base always falls back to the default under the data dir.
function backupsBase(custom) {
  return custom ? path.resolve(custom) : path.join(dataDir(), "backups");
}

const P = {
  data: () => dataDir(),
  db: () => path.join(dataDir(), "registry.sqlite"),
  steamcmd: () => ensure(path.join(dataDir(), "steamcmd")),
  logs: () => ensure(path.join(dataDir(), "logs")),
  backups: (custom) => ensure(backupsBase(custom)),
  defaultBackupsBase: () => path.join(dataDir(), "backups"),
  staging: () => ensure(path.join(dataDir(), "staging")),
  worldLogDir: (worldId) => ensure(path.join(dataDir(), "logs", worldId)),
  worldBackupDir: (worldId, custom) => ensure(path.join(backupsBase(custom), worldId)),
};

module.exports = { P, ensure, platform: os.platform() };
