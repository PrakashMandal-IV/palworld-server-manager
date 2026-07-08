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
    if (p.percent != null) j.percent = p.percent;
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

// Extract progress/phase from a single SteamCMD stdout line.
//   "[ 96%] Downloading update (42,697 of 43,472 KB)..." -> { percent: 96, phase: "steamcmd" }
//   "[----] Extracting package..."                       -> { phase: "steamcmd", indeterminate }
function parseSteamProgress(line) {
  if (typeof line !== "string") return null;
  const dl = line.match(/\[\s*(\d+)%\]\s*Downloading update/i);
  if (dl) return { percent: parseInt(dl[1], 10), phase: "steamcmd", message: "Downloading update…" };
  const validating = line.match(/\[\s*(\d+)%\]\s*Validating/i);
  if (validating) return { percent: parseInt(validating[1], 10), phase: "steamcmd", message: "Validating files…" };
  if (/Extracting package/i.test(line)) return { phase: "steamcmd", message: "Extracting package…", percent: null };
  if (/Applying update/i.test(line)) return { phase: "steamcmd", message: "Applying update…", percent: null };
  if (/Installing update/i.test(line)) return { phase: "steamcmd", message: "Installing update…", percent: null };
  if (/Update complete/i.test(line) || /Success!\s*App/i.test(line)) return { phase: "steamcmd", message: "Download complete", percent: 100 };
  return null;
}

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
};
