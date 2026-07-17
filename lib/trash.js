// lib/trash.js
// Move a file or directory to the OS trash (Recycle Bin on Windows, Trash on
// Linux/macOS) instead of erasing it. Used for user-initiated data deletes so a
// mistake — or a guard we didn't think of — stays recoverable (issue #9).
//
// Dependency-free on purpose. The app ships as a Next.js *standalone* bundle
// whose file tracer misses binary assets (see scripts/prepare-standalone.js,
// which hand-copies the sqlite .wasm for that reason). A native npm module that
// bundles a helper .exe would not survive packaging, so we shell out to tools
// that are always present on each platform instead.
//
// trashPath() THROWS on failure and never falls back to a permanent delete —
// callers that guard against data loss should treat a throw as "do not proceed".

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// Move `target` to the OS trash. No-op if it doesn't exist. Throws on failure.
function trashPath(target) {
  if (!target) throw new Error("no path given");
  const abs = path.resolve(String(target).trim());
  if (!fs.existsSync(abs)) return; // nothing to trash

  if (process.platform === "win32") return winTrash(abs);
  if (process.platform === "darwin") return homeTrash(abs, path.join(os.homedir(), ".Trash"));
  return linuxTrash(abs);
}

// Windows: hand the path to the Recycle Bin via the VisualBasic file API, which
// is the same mechanism Explorer uses. The path is passed through an env var so
// no quoting/escaping of the path itself is needed. A dialog only appears on a
// real error; the timeout keeps a stuck dialog from hanging the request forever.
function winTrash(abs) {
  const script = [
    "Add-Type -AssemblyName Microsoft.VisualBasic;",
    "$p = $env:PSM_TRASH_TARGET;",
    "if (Test-Path -LiteralPath $p -PathType Container) {",
    "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin')",
    "} else {",
    "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin')",
    "}",
  ].join(" ");
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { env: { ...process.env, PSM_TRASH_TARGET: abs }, timeout: 60000, windowsHide: true, stdio: "ignore" },
  );
}

// Linux: prefer `gio trash` (glib, present on most desktops); fall back to the
// FreeDesktop trash spec so it still works where gio is missing (headless boxes).
function linuxTrash(abs) {
  try {
    execFileSync("gio", ["trash", "--force", "--", abs], { timeout: 60000, stdio: "ignore" });
    return;
  } catch (e) {
    if (e && e.code !== "ENOENT") {
      // gio exists but failed (e.g. no trash on this mount) — try the spec fallback,
      // and if that also fails, surface the original error.
      try { return xdgTrash(abs); } catch { throw e; }
    }
    return xdgTrash(abs); // gio not installed
  }
}

// FreeDesktop.org trash spec: move into $XDG_DATA_HOME/Trash (default
// ~/.local/share/Trash) with a matching .trashinfo record for later restore.
function xdgTrash(abs) {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  const trashRoot = path.join(base, "Trash");
  const filesDir = path.join(trashRoot, "files");
  const infoDir = path.join(trashRoot, "info");
  fs.mkdirSync(filesDir, { recursive: true });
  fs.mkdirSync(infoDir, { recursive: true });

  const name = uniqueName(filesDir, infoDir, path.basename(abs));
  const info =
    "[Trash Info]\n" +
    `Path=${encodeTrashPath(abs)}\n` +
    `DeletionDate=${localStamp()}\n`;
  // Write the info record first so the trash never holds an unrecorded orphan.
  fs.writeFileSync(path.join(infoDir, name + ".trashinfo"), info);
  try {
    moveInto(abs, path.join(filesDir, name));
  } catch (e) {
    try { fs.unlinkSync(path.join(infoDir, name + ".trashinfo")); } catch {}
    throw e;
  }
}

// macOS (dev only — releases ship win/linux): move into ~/.Trash.
function homeTrash(abs, trashDir) {
  fs.mkdirSync(trashDir, { recursive: true });
  const name = uniqueName(trashDir, null, path.basename(abs));
  moveInto(abs, path.join(trashDir, name));
}

// Rename when possible; copy+remove across filesystems (rename gives EXDEV).
function moveInto(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code !== "EXDEV") throw e;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

// A name not already taken in the trash's files/ (and info/) dirs.
function uniqueName(filesDir, infoDir, base) {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let candidate = base;
  let n = 1;
  const taken = (nm) =>
    fs.existsSync(path.join(filesDir, nm)) ||
    (infoDir && fs.existsSync(path.join(infoDir, nm + ".trashinfo")));
  while (taken(candidate)) candidate = `${stem}.${n++}${ext}`;
  return candidate;
}

// Percent-encode per the trash spec: encode each segment, keep the separators.
function encodeTrashPath(abs) {
  return abs.split("/").map((seg) => encodeURIComponent(seg)).join("/");
}

// Local time, no timezone suffix, e.g. 2026-07-17T14:03:22 (spec format).
function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

module.exports = { trashPath };
