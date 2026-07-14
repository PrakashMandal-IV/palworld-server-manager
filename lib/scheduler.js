// lib/scheduler.js  (spec §7 scheduler, §8 update all)
const dbm = require("./db");
const steam = require("./steamcmd");
const sup = require("./supervisor");
const jobs = require("./jobs");
const warn = require("./warn");
const rest = require("./restclient");
const { createBackup } = require("./backups");
const { notify } = require("./notify");

const g = globalThis;
if (!g.__PAL_SCHED) g.__PAL_SCHED = { timer: null, bcastTimer: null, bcastBusy: false, updating: new Set() };
const ST = g.__PAL_SCHED;

function ensureScheduler() {
  // Schedule jobs (backup/restart/update) are coarse — a once-a-minute check is fine.
  if (!ST.timer) {
    ST.timer = setInterval(tick, 60 * 1000);
    tick();
  }
  // Broadcasts need to fire close to their exact second, so poll them fast on their
  // own light ticker (a single indexed query) instead of waiting for the minute tick.
  if (!ST.bcastTimer) {
    ST.bcastTimer = setInterval(broadcastTick, 2000);
  }
}

// Fire due broadcasts, guarding against overlap if a delivery ever runs long.
async function broadcastTick() {
  if (ST.bcastBusy) return;
  ST.bcastBusy = true;
  try { await fireDueBroadcasts(Date.now()); }
  catch { /* logged per-broadcast inside */ }
  finally { ST.bcastBusy = false; }
}

function due(sched, now) {
  if (!sched.enabled) return false;
  // on_join isn't time-driven — it fires from the presence poller when a matching
  // player joins (see fireJoinSchedules), so the minute tick never picks it up.
  if (sched.mode === "on_join") return false;
  const last = sched.last_run || 0;
  if (sched.mode === "interval" && sched.interval_hours) {
    return now - last >= sched.interval_hours * 3600 * 1000;
  }
  if (sched.mode === "minutes" && sched.interval_minutes) {
    return now - last >= sched.interval_minutes * 60 * 1000;
  }
  if (sched.mode === "daily" && sched.time_of_day) {
    const [h, m] = sched.time_of_day.split(":").map(Number);
    const d = new Date(now);
    const target = new Date(d); target.setHours(h, m, 0, 0);
    // fire within the minute window, and not already run today
    const ranToday = last && new Date(last).toDateString() === d.toDateString();
    return !ranToday && d >= target && d - target < 90 * 1000;
  }
  return false;
}

async function tick() {
  const now = Date.now();
  // Broadcasts are handled by their own fast ticker (broadcastTick); this minute
  // loop only drives the coarse backup/restart/update schedules.
  for (const s of dbm.listSchedules()) {
    if (!due(s, now)) continue;
    dbm.updateScheduleRun(s.id, now);
    try {
      if (s.job_type === "backup") await createBackup(s.world_id, "scheduled");
      else if (s.job_type === "restart") await scheduledRestart(s.world_id);
      else if (s.job_type === "update") await updateWorld(s.world_id);
      else if (s.job_type === "system_message") await sendSystemMessage(s.world_id, s.message);
      else if (s.job_type === "onscreen_notice") await sendOnScreenNotice(s.world_id, s.message);
      dbm.logEvent(s.world_id, "scheduler", `Ran ${s.job_type} job`);
    } catch (e) {
      dbm.logEvent(s.world_id, "scheduler", `Job ${s.job_type} failed: ${e.message}`);
    }
  }
}

// How late a due broadcast may be and still fire normally. Anything past this (the
// app was closed through the scheduled time) is treated as *missed* — kept and flagged
// so the user can reschedule it or send it now, rather than firing hours late.
const BROADCAST_GRACE_MS = 2 * 60 * 1000;

// Deliver any pending broadcasts whose time has arrived. A fresh one (within the grace
// window) fires and is removed; one that's long past, or can't reach a live server, is
// flagged 'missed' and kept for the user to act on.
async function fireDueBroadcasts(now) {
  for (const b of dbm.dueBroadcasts(now)) {
    const w = dbm.getWorld(b.world_id);
    const tooLate = now - b.fire_at > BROADCAST_GRACE_MS;
    const canSend = w && sup.isAlive(b.world_id) &&
      (sup.broadcastModInstalled(w.install_dir) || w.rest_api_enabled);
    // Missed: the window passed while the app was closed, or there's no live server to
    // deliver to. Keep it and mark it so the UI can offer reschedule / send now.
    if (tooLate || !canSend) {
      dbm.markBroadcastMissed(b.id);
      dbm.logEvent(b.world_id, "broadcast",
        tooLate ? `Missed scheduled broadcast (app was closed): ${b.message}`
                : `Missed scheduled broadcast (server offline): ${b.message}`);
      continue;
    }
    try {
      if (sup.broadcastModInstalled(w.install_dir)) {
        sup.enqueueBroadcast(w.install_dir, b.message);
        dbm.logEvent(b.world_id, "broadcast", `Sent scheduled broadcast (mod): ${b.message}`);
      } else {
        await rest.announce(w, b.message);
        dbm.logEvent(b.world_id, "broadcast", `Sent scheduled broadcast (rest): ${b.message}`);
      }
      dbm.deleteBroadcast(b.id); // delivered → remove
    } catch (e) {
      // Delivery blew up (e.g. REST error) — flag missed rather than lose it silently.
      dbm.markBroadcastMissed(b.id);
      dbm.logEvent(b.world_id, "broadcast", `Scheduled broadcast failed, kept as missed: ${e.message}`);
    }
  }
}

async function scheduledRestart(worldId) {
  const w = dbm.getWorld(worldId);
  if (!w) return;
  await createBackup(worldId, "pre-restart-safety").catch(() => {});
  await notify(worldId, "restart", `Scheduled restart of ${w.display_name}`);
  // Warn players first (if configured), then restart with the native red
  // countdown for the final minute.
  const { finalWaittime } = await warn.runPreShutdownWarning(worldId, sup.isAlive);
  await sup.restartWorld(worldId, { waittime: finalWaittime });
}

// ---- Scheduled messages (system announce + on-screen notice) ----

// Substitute {player} in a message with the joining player's name (used by the
// on_join trigger; a no-op for time-based schedules where there's no player).
function personalize(message, playerName) {
  if (!message) return message;
  return message.replace(/\{player\}/gi, playerName || "");
}

// A plain server announce — lands in the in-game chat feed as a System message,
// exactly like the Chat tab's Announce button (rest.announce).
async function sendSystemMessage(worldId, message) {
  const w = dbm.getWorld(worldId);
  if (!w || !String(message || "").trim()) return;
  if (!sup.isAlive(worldId)) return; // nothing to announce to
  await rest.announce(w, message);
}

// An on-screen notice — delivered through the PSMBroadcast mod so it pops on
// every player's screen, falling back to the REST announce (chat feed) when the
// mod isn't installed. Mirrors the Broadcast tab's delivery.
async function sendOnScreenNotice(worldId, message) {
  const w = dbm.getWorld(worldId);
  if (!w || !String(message || "").trim()) return;
  if (!sup.isAlive(worldId)) return;
  if (sup.broadcastModInstalled(w.install_dir)) sup.enqueueBroadcast(w.install_dir, message);
  else await rest.announce(w, message);
}

// Called by the presence poller whenever a player joins. Fires any enabled
// on_join message schedules for this world whose matcher accepts the player.
// A blank matcher means "anyone"; otherwise it's a case-insensitive exact match
// on the player's name. {player} in the message is replaced with their name.
async function fireJoinSchedules(worldId, playerName) {
  const name = String(playerName || "").trim();
  for (const s of dbm.listSchedules(worldId)) {
    if (!s.enabled || s.mode !== "on_join") continue;
    if (s.job_type !== "system_message" && s.job_type !== "onscreen_notice") continue;
    const matcher = String(s.join_match || "").trim();
    if (matcher && matcher.toLowerCase() !== name.toLowerCase()) continue;
    const msg = personalize(s.message, name);
    try {
      if (s.job_type === "system_message") await sendSystemMessage(worldId, msg);
      else await sendOnScreenNotice(worldId, msg);
      dbm.updateScheduleRun(s.id, Date.now());
      dbm.logEvent(worldId, "scheduler", `Sent on-join ${s.job_type} for ${name || "any player"}`);
    } catch (e) {
      dbm.logEvent(worldId, "scheduler", `On-join job failed: ${e.message}`);
    }
  }
}

// ---- Update All / per-world update (spec §8) ----
async function checkUpdates() {
  const latest = await steam.fetchLatestBuildId();
  if (!latest) return { latest: null, worlds: [] };
  const flagged = [];
  for (const w of dbm.listWorlds()) {
    dbm.updateWorld(w.world_id, { latest_known_build_id: latest });
    if (w.build_id && w.build_id !== latest) flagged.push(w.world_id);
  }
  return { latest, worlds: flagged };
}

async function updateWorld(worldId, onLog = () => {}, jobId = null) {
  const emit = (l) => { onLog(l); if (jobId) jobs.logJob(jobId, l); };
  const phase = (p, m) => { if (jobId) jobs.setPhase(jobId, p, m); };
  if (ST.updating.has(worldId)) {
    if (jobId) jobs.finishJob(jobId, false, { worldId, error: "Already updating" });
    return { skipped: "already updating" };
  }
  ST.updating.add(worldId);
  const w = dbm.getWorld(worldId);
  try {
    const wasRunning = sup.isAlive(worldId);
    if (wasRunning) {
      // Give players advance notice before we take the server down to update.
      const { finalWaittime } = await warn.runPreShutdownWarning(worldId, sup.isAlive);
      phase("finalizing", "Saving and shutting down…");
      emit("Saving and shutting down...");
      await sup.stopWorld(worldId, { graceful: true, waittime: finalWaittime });
    }
    dbm.updateWorld(worldId, { status: "updating" });
    phase("backup", "Creating safety backup…");
    emit("Creating safety backup...");
    await createBackup(worldId, "pre-update-safety").catch(() => {});
    // Worlds adopted from an existing install never went through provisioning, so
    // the shared SteamCMD may not be installed yet — updating would fail. Make sure
    // it's present before we try to run it.
    if (!steam.steamcmdInstalled()) {
      phase("steamcmd", "Installing SteamCMD…");
      emit("SteamCMD not found — installing it first...");
      await steam.ensureSteamCmd(emit);
    }
    phase("steamcmd", "Running SteamCMD update…");
    emit("Running SteamCMD update...");
    const res = await steam.installOrUpdate(w.install_dir, emit);
    if (!res.ok) throw new Error(`SteamCMD failed (${res.code})`);
    const bid = res.buildId || steam.readInstalledBuildId(w.install_dir);
    if (bid) dbm.updateWorld(worldId, { build_id: bid });
    dbm.updateWorld(worldId, { status: "stopped" });
    if (wasRunning) { phase("finalizing", "Relaunching…"); emit("Relaunching..."); await sup.startWorld(worldId); }
    dbm.logEvent(worldId, "update", `Updated to build ${bid || "?"}`);
    await notify(worldId, "update", `${w.display_name} updated to build ${bid || "?"}`);
    if (jobId) jobs.finishJob(jobId, true, { worldId });
    return { ok: true, build: bid };
  } catch (e) {
    dbm.updateWorld(worldId, { status: "stopped" });
    if (jobId) jobs.finishJob(jobId, false, { worldId, error: e.message });
    return { ok: false, error: e.message };
  } finally {
    ST.updating.delete(worldId);
  }
}

async function updateAll(onLog = () => {}) {
  const { worlds } = await checkUpdates();
  const results = [];
  for (const id of worlds) {
    const w = dbm.getWorld(id);
    const jobId = jobs.createJob({ type: "update", worldId: id, worldName: w?.display_name || "" });
    onLog(`Updating world ${id}...`);
    results.push({ worldId: id, ...(await updateWorld(id, onLog, jobId)) });
  }
  return results;
}

// Kick off a single world update as a tracked background job; returns the jobId
// immediately so the caller (HTTP route) doesn't block on the whole SteamCMD run.
function startUpdateJob(worldId) {
  const w = dbm.getWorld(worldId);
  if (!w) return null;
  const jobId = jobs.createJob({ type: "update", worldId, worldName: w.display_name || "" });
  // fire and forget — progress is polled via /api/jobs
  updateWorld(worldId, () => {}, jobId);
  return jobId;
}

module.exports = { ensureScheduler, tick, checkUpdates, updateWorld, updateAll, startUpdateJob, fireJoinSchedules };
