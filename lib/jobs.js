// lib/jobs.js
// One global registry for long-running download/update jobs (installs + updates),
// so the UI can surface them all in a single Epic-style downloads tray instead of
// a per-modal log. Lives on globalThis so every Next route handler in the process
// shares the same store.
const crypto = require("crypto");

const g = globalThis;
if (!g.__PAL_JOBS2) g.__PAL_JOBS2 = new Map();
const JOBS = g.__PAL_JOBS2;

const MAX_LINES = 2000;
const KEEP_FINISHED_MS = 10 * 60 * 1000; // linger finished jobs for 10 min

// Create a job. type: "install" | "update".
function createJob({ type, worldId = null, worldName = "" }) {
  const id = crypto.randomUUID();
  JOBS.set(id, {
    id,
    type,
    worldId,
    worldName,
    status: "running", // running | success | error
    phase: "starting", // starting | steamcmd | backup | settings | finalizing
    percent: null, // 0..100 during download phase, null when indeterminate
    message: "Starting…",
    lines: [],
    error: null,
    startedAt: Date.now(),
    endedAt: null,
  });
  prune();
  return id;
}

function getJob(id) {
  return JOBS.get(id) || null;
}

// Active jobs first, then most-recently-finished; caps the list for the tray.
function listJobs() {
  prune();
  return [...JOBS.values()].sort((a, b) => {
    const ar = a.status === "running" ? 1 : 0;
    const br = b.status === "running" ? 1 : 0;
    if (ar !== br) return br - ar;
    return (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt);
  });
}

function setPhase(id, phase, message) {
  const j = JOBS.get(id);
  if (!j) return;
  j.phase = phase;
  if (message != null) j.message = message;
}

function setProgress(id, percent, message) {
  const j = JOBS.get(id);
  if (!j) return;
  if (percent != null) j.percent = Math.max(0, Math.min(100, percent));
  if (message != null) j.message = message;
}

// Append a raw log line and opportunistically update phase/percent from SteamCMD output.
function logJob(id, line) {
  const j = JOBS.get(id);
  if (!j) return;
  j.lines.push(line);
  if (j.lines.length > MAX_LINES) j.lines.shift();
  const p = parseSteamProgress(line);
  if (p) {
    if (p.phase) j.phase = p.phase;
    // Assign whenever the parser reports a percent key — including null, which
    // switches the bar to indeterminate. This is what stops it sticking at 100%
    // after SteamCMD's self-update finishes and the real app download begins.
    if ("percent" in p) j.percent = p.percent == null ? null : Math.max(0, Math.min(100, p.percent));
    if (p.message) j.message = p.message;
  }
}

function finishJob(id, ok, { error = null, worldId } = {}) {
  const j = JOBS.get(id);
  if (!j) return;
  j.status = ok ? "success" : "error";
  j.error = ok ? null : error;
  j.percent = ok ? 100 : j.percent;
  j.phase = "finalizing";
  j.message = ok ? "Complete" : error || "Failed";
  j.endedAt = Date.now();
  if (worldId !== undefined) j.worldId = worldId;
}

// Extract progress/phase from a single SteamCMD stdout line. SteamCMD emits two
// unrelated progress formats and this must understand both:
//
//   Format A — the SteamCMD bootstrapper updating *itself* (~40 MB):
//     "[ 96%] Downloading update (42,697 of 43,472 KB)..."  -> phase "steamcmd", 96%
//     "[----] Installing update..."                          -> phase "steamcmd", indeterminate
//
//   Format B — the actual Palworld app depot download (multi-GB):
//     " Update state (0x61) downloading, progress: 1.51 (63599352 / 4199616479)"
//                                                             -> phase "download", 2%
//     " Update state (0x5) verifying, progress: 40.00 (...)"  -> phase "verify"
//     "Success! App '2394010' fully installed."               -> phase "install", 100%
//
// Returning `percent: null` is meaningful — it flips the bar to indeterminate,
// which is how we escape the "stuck at 100%" state between the two phases.
function parseSteamProgress(line) {
  if (typeof line !== "string") return null;

  // Format B: the real app download / verify / install.
  const us = line.match(/Update state\s*\(0x[0-9a-f]+\)\s*([a-z ]+?)\s*,\s*progress:\s*([\d.]+)/i);
  if (us) {
    const word = us[1].trim().toLowerCase();
    const raw = parseFloat(us[2]);
    const pct = Number.isFinite(raw) ? Math.round(raw) : null;
    if (word.includes("download")) return { phase: "download", percent: pct || null, message: "Downloading server files…" };
    if (word.includes("verif")) return { phase: "verify", percent: pct, message: "Verifying files…" };
    if (word.includes("commit") || word.includes("stag") || word.includes("alloc"))
      return { phase: "install", percent: pct, message: "Installing files…" };
    if (word.includes("reconfig")) return { phase: "prepare", percent: null, message: "Preparing update…" };
    return { phase: "install", percent: pct, message: `${word.charAt(0).toUpperCase()}${word.slice(1)}…` };
  }

  // Format A: the SteamCMD self-update.
  const dl = line.match(/\[\s*(\d+)%\]\s*Downloading update/i);
  if (dl) return { percent: parseInt(dl[1], 10), phase: "steamcmd", message: "Updating SteamCMD…" };
  const validating = line.match(/\[\s*(\d+)%\]\s*Validating/i);
  if (validating) return { percent: parseInt(validating[1], 10), phase: "verify", message: "Verifying files…" };
  if (/Extracting package/i.test(line)) return { phase: "install", message: "Extracting package…", percent: null };
  if (/Applying update/i.test(line)) return { phase: "install", message: "Applying update…", percent: null };
  if (/Installing update/i.test(line)) return { phase: "install", message: "Installing update…", percent: null };
  if (/Success!\s*App/i.test(line) || /fully installed/i.test(line)) return { phase: "install", message: "Install complete", percent: 100 };
  // The bootstrapper's own "Download complete" — it's only SteamCMD, not the app;
  // keep it indeterminate so we don't imply the whole job is done.
  if (/Download complete/i.test(line)) return { phase: "install", message: "Preparing install…", percent: null };
  return null;
}

// Human-readable label for a phase, shared with the UI.
const PHASE_LABELS = {
  starting: "Starting", steamcmd: "Updating SteamCMD", prepare: "Preparing",
  download: "Downloading server files", verify: "Verifying files", install: "Installing",
  backup: "Backing up", settings: "Writing settings", finalizing: "Finishing up",
};
function phaseLabel(phase) { return PHASE_LABELS[phase] || "Working"; }

// Drop finished jobs that have lingered past the retention window.
function prune() {
  const now = Date.now();
  for (const [id, j] of JOBS) {
    if (j.status !== "running" && j.endedAt && now - j.endedAt > KEEP_FINISHED_MS) {
      JOBS.delete(id);
    }
  }
}

module.exports = {
  createJob, getJob, listJobs, setPhase, setProgress, logJob, finishJob, parseSteamProgress,
  phaseLabel, PHASE_LABELS,
};
