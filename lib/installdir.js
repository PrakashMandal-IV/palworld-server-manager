// lib/installdir.js
// Safety rails around a world's install folder.
//
// Deleting a world with "also delete files" runs rm -rf on install_dir, so a bad
// value there is unrecoverable data loss. Nothing used to stop one world's folder
// from sitting *above* another's: pick "H:\PalworldServers" as the install folder
// for a second server and SteamCMD installs straight into the folder that already
// holds the first one. Deleting that world then took its sibling with it (issue #9).
//
// Two layers guard against it — refuse the overlapping folder at create time, and
// refuse the delete itself if a world somehow already points at one. The checks are
// deliberately conservative: when a folder isn't clearly a self-contained Palworld
// install, we decline and let the user remove it by hand.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { P } = require("./paths");

// Resolve for comparison: absolute, no trailing separator, and case-folded on
// Windows, where "H:\Pal" and "h:\pal" are the same folder.
function norm(p) {
  if (!p) return "";
  const r = path.resolve(String(p).trim());
  return process.platform === "win32" ? r.toLowerCase() : r;
}

// True when `parent` is at or above `child`, i.e. removing parent removes child.
// Compares whole segments so "H:\Pal" does not look like it contains "H:\Palworld".
function contains(parent, child) {
  const p = norm(parent);
  const c = norm(child);
  if (!p || !c) return false;
  if (p === c) return true;
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

// A drive root ("H:\") or filesystem root ("/") is its own parent.
function isRoot(p) {
  const r = norm(p);
  return !!r && path.dirname(r) === r;
}

// Folders that must never be inside something we delete.
function protectedDirs(extra = []) {
  const dirs = [os.homedir()];
  try { dirs.push(P.data()); } catch {}
  return [...dirs, ...extra].filter(Boolean);
}

// Names that mark a folder as a Palworld server install rather than, say, the
// user's Documents. "steamapps" counts so a half-finished SteamCMD install can
// still be cleaned up.
const INSTALL_MARKERS = ["palserver.exe", "palserver.sh", "pal", "steamapps"];

function looksLikeInstall(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return false; }
  if (!entries.length) return true; // empty folder — nothing to lose
  return entries.some((e) => INSTALL_MARKERS.includes(e.toLowerCase()));
}

// Why `dir` must not be rm -rf'd for this world, or null when it's safe to delete.
// The reason is a sentence fragment meant to follow "because ...".
function unsafeToDeleteReason(dir, { worlds = [], selfWorldId = null, extraProtected = [] } = {}) {
  if (!dir || !norm(dir)) return "no install folder is recorded for it";
  if (isRoot(dir)) return "it is the root of a drive";

  for (const other of worlds) {
    if (!other || other.world_id === selfWorldId || !other.install_dir) continue;
    if (contains(dir, other.install_dir)) {
      return `it also holds "${other.display_name || other.world_id}"`;
    }
  }

  for (const p of protectedDirs(extraProtected)) {
    if (contains(dir, p)) return `it contains ${p}`;
  }

  if (!looksLikeInstall(dir)) return "it does not look like a Palworld server folder";
  return null;
}

// Why `dir` can't be used as an install folder for a new/moved world, or null when
// it's fine. Catches the overlap at the point where it's still harmless to fix.
function unusableTargetReason(dir, { worlds = [], selfWorldId = null } = {}) {
  if (!dir || !norm(dir)) return "Choose an install folder.";
  if (isRoot(dir)) return "Choose a folder on the drive rather than the drive root itself.";

  for (const other of worlds) {
    if (!other || other.world_id === selfWorldId || !other.install_dir) continue;
    const name = other.display_name || other.world_id;
    if (contains(dir, other.install_dir)) {
      return `That folder already holds "${name}". Pick a separate subfolder — otherwise deleting one server would delete the other.`;
    }
    if (contains(other.install_dir, dir)) {
      return `That folder is inside "${name}"'s install folder. Pick a folder outside it.`;
    }
  }

  try {
    if (contains(dir, P.data())) return "That folder holds the app's own data. Pick another one.";
  } catch {}
  return null;
}

module.exports = { norm, contains, isRoot, looksLikeInstall, unsafeToDeleteReason, unusableTargetReason };
