// lib/warn.js  (v1.5.0 pre-shutdown warning countdown)
// Broadcasts timed notices to players before a restart/update, then hands the
// final stretch off to Palworld's native red shutdown countdown.
//
// Palworld's REST API has no way to draw arbitrary coloured on-screen text: the
// only built-in "big red" banner is the shutdown countdown triggered by the
// `shutdown` command's waittime. So we send our custom messages as `announce`
// broadcasts at each checkpoint, then stop with a native countdown for the last
// minute — that final minute is the red banner players can't miss.
const dbm = require("./db");
const rest = require("./restclient");

// Seconds of the very end handled by Palworld's native red shutdown countdown.
const FINAL = 60;
// Waittime used when warnings are off — matches the app's previous behaviour.
const DEFAULT_WAITTIME = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Fill {minutes} / {seconds} in the user's message template.
function fmt(tpl, totalSeconds) {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return String(tpl || "The server will restart in {minutes} minute(s).")
    .split("{minutes}").join(String(minutes))
    .split("{seconds}").join(String(totalSeconds));
}

// True when this world is configured to warn players and can actually broadcast.
function shouldWarn(world, isRunning, worldId) {
  if (!world || !world.warn_enabled || !world.rest_api_enabled) return false;
  if (typeof isRunning === "function" && !isRunning(worldId)) return false;
  return (parseInt(world.warn_lead_minutes, 10) || 0) > 0;
}

// Run the warning countdown, blocking for (lead - final) so the caller can then
// stop the world with the returned finalWaittime for the native red countdown.
// No-ops (returns the default waittime immediately) when warnings don't apply.
async function runPreShutdownWarning(worldId, isRunning) {
  const w = dbm.getWorld(worldId);
  if (!shouldWarn(w, isRunning, worldId)) return { finalWaittime: DEFAULT_WAITTIME };

  const total = (parseInt(w.warn_lead_minutes, 10) || 0) * 60;
  const interval = (parseInt(w.warn_interval_minutes, 10) || 0) * 60;

  // Whole window shorter than the native countdown: one announce, then hand off.
  if (total <= FINAL) {
    try { await rest.announce(w, fmt(w.warn_message, total)); } catch {}
    dbm.logEvent(worldId, "warn", "Shutdown warning broadcast to players");
    return { finalWaittime: total };
  }

  // Checkpoints (seconds remaining) at which to broadcast, all above the native
  // countdown. interval<=0 or >= lead ⇒ a single warning at the very start.
  let points;
  if (interval <= 0 || interval >= total) {
    points = [total];
  } else {
    points = [];
    for (let s = total; s > FINAL; s -= interval) points.push(s);
  }
  const checkpoints = [...new Set(points)].filter((s) => s > FINAL).sort((a, b) => b - a);

  let remaining = total;
  for (const c of checkpoints) {
    if (remaining - c > 0) await sleep((remaining - c) * 1000);
    remaining = c;
    // Bail out if the world went away (crashed / manually stopped) mid-countdown.
    if (typeof isRunning === "function" && !isRunning(worldId)) return { finalWaittime: DEFAULT_WAITTIME };
    const msg = fmt(w.warn_message, remaining);
    try { await rest.announce(w, msg); } catch {}
    dbm.logEvent(worldId, "warn", `Shutdown warning to players: ${msg}`);
  }
  // Hold out the remaining time down to the native-countdown handoff.
  if (remaining > FINAL) await sleep((remaining - FINAL) * 1000);
  return { finalWaittime: FINAL };
}

// Warn players, then restart. Meant to be run in the background (it can block for
// the full lead time). Requires supervisor lazily to avoid a require cycle.
async function warnedRestart(worldId) {
  const sup = require("./supervisor");
  try {
    const { finalWaittime } = await runPreShutdownWarning(worldId, sup.isRunning);
    await sup.restartWorld(worldId, { waittime: finalWaittime });
  } catch (e) {
    dbm.logEvent(worldId, "warn", `Warned restart failed: ${e.message}`);
  }
}

module.exports = { runPreShutdownWarning, warnedRestart, shouldWarn };
