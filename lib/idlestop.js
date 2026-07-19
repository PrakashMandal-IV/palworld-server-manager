// lib/idlestop.js
// Idle auto-stop: when a running world has had nobody online for a configured
// stretch, stop it — sending a one-minute heads-up to Discord first if the world
// has anywhere to announce to (webhook preferred, the bot's notify channel next).
//
// This is presence-driven, not time-driven: the presence poller (lib/presence.js)
// already fetches each running, REST-enabled world's player list every ~10s, so it
// calls evaluate() with that list. clear() is called when a world stops or loses its
// rule so a pending timer never fires against the wrong state.
//
// The configuration lives in the schedules table as a job_type="idle_stop" row whose
// mode/interval columns carry the idle threshold (minutes or hours) — so it shows up
// and is managed on the Schedule tab like every other job, but the minute-tick
// scheduler deliberately skips it (see scheduler.due).
const dbm = require("./db");
const sup = require("./supervisor");
const { post } = require("./notify");
const { normalizeDiscord, webhookFor } = require("./discord-routing");
const cfgLib = require("./discord-bot-config");
const bot = require("./discordbot");

const WARNING_MS = 60 * 1000; // one-minute heads-up before the stop

const g = globalThis;
if (!g.__PAL_IDLE) g.__PAL_IDLE = new Map(); // world_id -> { emptySince, pending, timer }

function state(wid) {
  let s = g.__PAL_IDLE.get(wid);
  if (!s) { s = { emptySince: null, pending: false, timer: null }; g.__PAL_IDLE.set(wid, s); }
  return s;
}

// The enabled idle-stop rule for a world, if any, with its threshold resolved to ms.
// First enabled one wins — there's no sense in two.
function idleRule(worldId) {
  for (const s of dbm.listSchedules(worldId)) {
    if (s.job_type !== "idle_stop" || !s.enabled) continue;
    let ms = 0;
    if (s.mode === "minutes" && s.interval_minutes) ms = s.interval_minutes * 60 * 1000;
    else if (s.mode === "interval" && s.interval_hours) ms = s.interval_hours * 3600 * 1000;
    if (ms > 0) return { schedule: s, thresholdMs: ms };
  }
  return null;
}

function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h} hour${h === 1 ? "" : "s"}`;
}

function firstHookUrl(world) {
  const { hooks } = normalizeDiscord(world);
  const h = hooks.find((x) => x.url);
  return h ? h.url : "";
}

// Where an idle warning should go. A routed webhook wins (idle-stop is a stop, so we
// reuse the "stop" route, falling back to the world's first configured hook); the
// bot's chosen notify channel is the fallback. null means "nowhere to announce".
function announceTarget(world) {
  const url = webhookFor(world, "stop") || firstHookUrl(world);
  if (url) return { kind: "webhook", url };
  const c = cfgLib.normalizeBotConfig(world);
  if (c.enabled && c.token && c.notifyChannelId) return { kind: "bot", channelId: c.notifyChannelId };
  return null;
}

async function announce(world, target, text) {
  try {
    if (target.kind === "webhook") await post(target.url, { content: text });
    else await bot.postToChannel(world.world_id, target.channelId, text);
  } catch { /* best effort — a failed heads-up must not block the stop */ }
}

function clear(worldId) {
  const s = g.__PAL_IDLE.get(worldId);
  if (s && s.timer) clearTimeout(s.timer);
  g.__PAL_IDLE.delete(worldId);
}

// Called by the presence poller each tick for a running, REST-enabled world, with its
// current player list. Drives the empty-timer and, once the threshold is crossed, the
// one-minute warning and stop.
function evaluate(world, players) {
  const wid = world.world_id;
  const rule = idleRule(wid);
  if (!rule || !sup.isAlive(wid)) { clear(wid); return; }

  const count = Array.isArray(players) ? players.length : 0;
  const s = state(wid);

  if (count > 0) {
    // Someone's on. Reset the empty-timer, and cancel a pending stop if a player
    // returned during the one-minute warning — this is the "reset the timer on join"
    // the feature asks for.
    if (s.pending) {
      if (s.timer) clearTimeout(s.timer);
      s.pending = false; s.timer = null;
      dbm.logEvent(wid, "scheduler", "Idle auto-stop cancelled — a player came back");
    }
    s.emptySince = null;
    return;
  }

  // Empty from here down.
  if (s.pending) return; // stop already warned/scheduled
  const now = Date.now();
  if (s.emptySince == null) { s.emptySince = now; return; }
  if (now - s.emptySince < rule.thresholdMs) return;

  // Threshold reached. Warn Discord if we can, then stop a minute later; with nowhere
  // to announce, just stop now.
  s.pending = true;
  const target = announceTarget(world);
  const idleFor = fmtDuration(rule.thresholdMs);
  if (target) {
    announce(world, target, `**[idle]** No one has been online on ${world.display_name} for ${idleFor}. It will shut down in 1 minute.`);
    dbm.logEvent(wid, "scheduler", `Idle for ${idleFor} — warned Discord, stopping in 1 minute`);
    s.timer = setTimeout(() => { doStop(wid).catch(() => {}); }, WARNING_MS);
    if (s.timer.unref) s.timer.unref();
  } else {
    dbm.logEvent(wid, "scheduler", `Idle for ${idleFor} — no Discord configured, stopping now`);
    doStop(wid).catch(() => {});
  }
}

async function doStop(worldId) {
  const s = g.__PAL_IDLE.get(worldId);
  if (s) s.timer = null;
  const world = dbm.getWorld(worldId);
  // Last-moment guard: the world may already be down, or a player may have slipped in
  // during the warning minute (the poller normally cancels the timer, but re-checking
  // the latest snapshot closes the race either way).
  if (!world || !sup.isAlive(worldId) || require("./presence").onlineCount(worldId) > 0) { clear(worldId); return; }
  try {
    await sup.stopWorld(worldId, { graceful: true, waittime: 5 });
    dbm.logEvent(worldId, "scheduler", `Idle auto-stop — ${world.display_name} stopped`);
  } catch (e) {
    dbm.logEvent(worldId, "scheduler", `Idle auto-stop failed: ${e.message}`);
  } finally {
    clear(worldId);
  }
}

module.exports = { evaluate, clear, idleRule };
