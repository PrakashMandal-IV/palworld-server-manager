// lib/supervisor.js  (spec §4 lifecycle, §5 log capture, §9 crash guardian)
// Holds live child processes in memory (singleton across the Next server runtime).
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const kill = require("tree-kill");
const { P } = require("./paths");
const dbm = require("./db");
const rest = require("./restclient");
const ini = require("./ini");
const notify = require("./notify");
const { webhookFor } = require("./discord-routing");

const RING = 500; // lines kept in memory per world

// Global singleton so hot-reload / multiple route handlers share state.
const g = globalThis;
if (!g.__PAL_SUP) {
  g.__PAL_SUP = {
    procs: new Map(),          // world_id -> child process
    logs: new Map(),           // world_id -> string[] ring buffer
    listeners: new Map(),      // world_id -> Set(fn) for live log streaming
    chat: new Map(),           // world_id -> chat entry[] ring buffer
    chatListeners: new Map(),  // world_id -> Set(fn) for live chat streaming
    chatTails: new Map(),      // world_id -> { timer, offset } for the chat-file tailer
    guardTimer: null,
  };
}
const S = g.__PAL_SUP;

function serverBinary(installDir) {
  if (os.platform() === "win32") return path.join(installDir, "PalServer.exe");
  return path.join(installDir, "PalServer.sh");
}

function buildArgs(world) {
  const args = [
    `-port=${world.game_port}`,
    `-queryport=${world.query_port}`,
    // NOTE: we deliberately do NOT pass -publicport. It would override the ini's
    // PublicPort, which the user can now set in Server Identity (e.g. a tunnel's
    // public port). PublicPort in the ini defaults to the game port, so ordinary
    // servers still advertise the correct port.
    `-RESTAPIPort=${world.rest_api_port}`,
    "-useperfthreads",
    "-NoAsyncLoadingThread",
    "-UseMultithreadForDS",
  ];
  if (world.rest_api_enabled) args.push("-RESTAPIEnabled=true");
  // If mods are explicitly disabled for this world, hard-disable via launch flag.
  if (!world.mods_enabled) args.push("-NoMods");
  // Community server: lists the server in Palworld's in-game public browser.
  // Current flag is -publiclobby; EpicApp=PalServer is the legacy equivalent kept
  // for older server builds. Both are harmless together.
  if (world.community_server) {
    args.push("-publiclobby");
    args.push("EpicApp=PalServer");
  }
  if (world.extra_args) args.push(...world.extra_args.split(/\s+/).filter(Boolean));
  return args;
}

function pushLog(worldId, line) {
  let buf = S.logs.get(worldId);
  if (!buf) { buf = []; S.logs.set(worldId, buf); }
  const stamped = `[${new Date().toISOString()}] ${line}`;
  buf.push(stamped);
  if (buf.length > RING) buf.shift();
  // append to rotating file
  try {
    fs.appendFileSync(path.join(P.worldLogDir(worldId), "console.log"), stamped + "\n");
  } catch {}
  // live listeners (SSE)
  const set = S.listeners.get(worldId);
  if (set) for (const fn of set) { try { fn(stamped); } catch {} }
  // chat detection — Palworld console emits: [<time>] [CHAT] <PlayerName> message
  const chat = parseChatLine(line);
  if (chat) recordChat(worldId, chat);
}

// Parse a Palworld console chat line into { name, message }.
// Formats seen in the wild (with optional ANSI color codes and timestamps):
//   [2026-07-07 13:55:48] [CHAT] <Frenzi> hello
//   [CHAT] <Frenzi> hello
//   [CHAT][Global] <Frenzi>: hello
//   [CHAT][Global][Frenzi(steam_123456)] hello world
//   [CHAT][Local][Frenzi] hello
function parseChatLine(line) {
  if (!line) return null;
  // strip ANSI color codes
  const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
  const idx = clean.indexOf("[CHAT]");
  if (idx === -1) return null;
  let rest = clean.slice(idx + 6).trim();

  // optional channel tag like [Global] / [Local] / [Guild]
  let channel = null;
  const KNOWN_CHANNELS = ["Global", "Local", "Guild", "Whisper", "Party"];
  const chan = rest.match(/^\[([^\]]+)\]\s*/);
  if (chan && KNOWN_CHANNELS.includes(chan[1])) {
    channel = chan[1];
    rest = rest.slice(chan[0].length);
  }

  // Format A: <Name> message   or   <Name>: message
  let m = rest.match(/^<([^>]+)>\s*:?\s*(.*)$/);
  if (m) return { name: cleanName(m[1]), message: m[2].trim(), channel };

  // Format B: [Name] message  or  [Name(steam_123)] message  or  [Name]: message
  m = rest.match(/^\[([^\]]+)\]\s*:?\s*(.*)$/);
  if (m) return { name: cleanName(m[1]), message: m[2].trim(), channel };

  // Format C: Name: message   (last resort, only if there's a colon)
  m = rest.match(/^([^:]{1,32}):\s+(.+)$/);
  if (m) return { name: cleanName(m[1]), message: m[2].trim(), channel };

  return null;
}

// Strip a trailing "(steam_12345)" or "(platform_id)" from a player name.
function cleanName(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function recordChat(worldId, chat) {
  let buf = S.chat.get(worldId);
  if (!buf) { buf = []; S.chat.set(worldId, buf); }
  const entry = { ...chat, at: chat.at || Date.now() };
  buf.push(entry);
  if (buf.length > 300) buf.shift();
  // notify chat listeners
  const set = S.chatListeners.get(worldId);
  if (set) for (const fn of set) { try { fn(entry); } catch {} }
  // optional Discord relay (Palworld -> Discord cross-chat)
  relayChatToDiscord(worldId, entry);
}

// Post a captured chat message to the Discord webhook this world routes chat to, if
// any. Uses the player's name as the webhook username so it reads like a cross-chat
// feed. Fire-and-forget; never throws into the tailer.
function relayChatToDiscord(worldId, entry) {
  try {
    const world = dbm.getWorld(worldId);
    if (!world) return;
    const url = webhookFor(world, "chat");
    if (!url) return;
    const name = entry.channel ? `${entry.name} [${entry.channel}]` : entry.name;
    notify.post(url, {
      username: `${name} (Palworld)`,
      content: entry.message,
      allowed_mentions: { parse: [] },
    });
  } catch {}
}

// ---- Chat-file tailer (spec: in-game chat capture) ----
// The vanilla server never prints chat to stdout, so chat is captured by the bundled
// PSMChatRelay UE4SS mod, which appends JSON lines to <install>/Pal/Saved/psm-chat.jsonl.
// We tail that file while the world runs.
function chatFilePath(installDir) {
  return path.join(installDir, "Pal", "Saved", "psm-chat.jsonl");
}

// UE4SS ships in two layouts and each scans a different Mods folder:
//   * 3.x: <Win64>/ue4ss/Mods/   (proxy dll in Win64, engine files under ue4ss/)
//   * 2.x: <Win64>/Mods/
// Return the Mods root this server's UE4SS actually scans.
function ue4ssModsRoot(installDir) {
  const win64 = path.join(installDir, "Pal", "Binaries", "Win64");
  if (fs.existsSync(path.join(win64, "ue4ss"))) {
    return path.join(win64, "ue4ss", "Mods"); // 3.x present
  }
  if (fs.existsSync(path.join(win64, "UE4SS.dll"))) {
    return path.join(win64, "Mods"); // 2.x present (engine dll sits directly in Win64)
  }
  // UE4SS not installed yet. The app's own UE4SS installer lays down the 3.x
  // layout, so default there — otherwise a chat mod installed *before* UE4SS would
  // be stranded in a folder 3.x never scans once UE4SS arrives.
  return path.join(win64, "ue4ss", "Mods");
}

// Every location a PSMChatRelay copy could live, newest layout first.
function chatModCandidates(installDir) {
  const win64 = path.join(installDir, "Pal", "Binaries", "Win64");
  return [
    path.join(win64, "ue4ss", "Mods", "PSMChatRelay"),
    path.join(win64, "Mods", "PSMChatRelay"),
  ];
}

// The bundled mod's install location inside a server (the scanned Mods root).
function chatModDir(installDir) {
  return path.join(ue4ssModsRoot(installDir), "PSMChatRelay");
}
// Installed if a copy with the Lua script exists in any known Mods location.
function chatModInstalled(installDir) {
  try {
    return chatModCandidates(installDir).some((d) =>
      fs.existsSync(path.join(d, "Scripts", "main.lua"))
    );
  } catch { return false; }
}

// Locate the bundled PSMChatRelay mod source, which differs between dev and packaged:
//   dev:      <repo>/resources/mods/PSMChatRelay
//   packaged: <resources/app>/psm-mods/PSMChatRelay  (assembled by prepare-standalone)
function bundledChatModDir() {
  const candidates = [
    path.join(process.cwd(), "psm-mods", "PSMChatRelay"),
    path.join(process.cwd(), "resources", "mods", "PSMChatRelay"),
    path.join(__dirname, "..", "resources", "mods", "PSMChatRelay"),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, "Scripts", "main.lua"))) return c; } catch {}
  }
  return null;
}

// Copy the bundled mod into a server's UE4SS Mods folder. Requires UE4SS to be
// installed (Pal/Binaries/Win64); we create the Mods folder if missing.
function installChatMod(installDir) {
  const src = bundledChatModDir();
  if (!src) throw new Error("Bundled chat relay mod not found in this build.");
  const win64 = path.join(installDir, "Pal", "Binaries", "Win64");
  if (!fs.existsSync(win64)) throw new Error("Server binaries folder not found (Pal/Binaries/Win64).");
  const ue4ssPresent =
    fs.existsSync(path.join(win64, "ue4ss")) ||
    fs.existsSync(path.join(win64, "UE4SS.dll")) ||
    fs.existsSync(path.join(win64, "dwmapi.dll")) ||
    fs.existsSync(path.join(win64, "Mods"));
  // Install into the Mods folder this UE4SS build actually scans.
  const dst = chatModDir(installDir);
  copyDirInto(src, dst);

  // Bake an absolute output path into the mod so it doesn't depend on UE4SS's
  // working directory (which differs between the 2.x and 3.x layouts).
  const outPath = chatFilePath(installDir).replace(/\\/g, "/");
  const scriptPath = path.join(dst, "Scripts", "main.lua");
  try {
    const lua = fs.readFileSync(scriptPath, "utf8");
    fs.writeFileSync(scriptPath, lua.replace(/__PSM_OUT_PATH__/g, outPath), "utf8");
  } catch {}

  // Make sure the Saved dir the mod writes to exists (it may not until first run).
  try { fs.mkdirSync(path.dirname(chatFilePath(installDir)), { recursive: true }); } catch {}

  // Remove any stale copy left in a Mods folder this UE4SS build no longer scans,
  // so there's exactly one active relay.
  for (const cand of chatModCandidates(installDir)) {
    if (path.resolve(cand) !== path.resolve(dst)) {
      try { fs.rmSync(cand, { recursive: true, force: true }); } catch {}
    }
  }

  return { installed: true, dir: dst, ue4ssDetected: ue4ssPresent };
}

// Remove the chat relay mod from every location it could live in a server, so a
// future Palworld update that makes the mod crash the game can be fully backed out.
function uninstallChatMod(installDir) {
  let removed = false;
  for (const cand of chatModCandidates(installDir)) {
    try {
      if (fs.existsSync(cand)) { fs.rmSync(cand, { recursive: true, force: true }); removed = true; }
    } catch {}
  }
  return { removed };
}

function copyDirInto(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, item.name);
    const d = path.join(dst, item.name);
    if (item.isDirectory()) copyDirInto(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ---- Broadcast mod (PSMBroadcast) ----
// The mirror of the chat relay: PSMChatRelay reads chat out of the game; PSMBroadcast
// takes messages the app writes and shows them on-screen via the server's system
// announce. The app appends one base64 JSON line per message to this queue file, which
// the mod tails while the world runs.
function broadcastQueuePath(installDir) {
  return path.join(installDir, "Pal", "Saved", "psm-broadcast.jsonl");
}
// Every location a PSMBroadcast copy could live, newest layout first.
function broadcastModCandidates(installDir) {
  const win64 = path.join(installDir, "Pal", "Binaries", "Win64");
  return [
    path.join(win64, "ue4ss", "Mods", "PSMBroadcast"),
    path.join(win64, "Mods", "PSMBroadcast"),
  ];
}
// The mod's install location inside a server (the scanned Mods root).
function broadcastModDir(installDir) {
  return path.join(ue4ssModsRoot(installDir), "PSMBroadcast");
}
// Installed if a copy with the Lua script exists in any known Mods location.
function broadcastModInstalled(installDir) {
  try {
    return broadcastModCandidates(installDir).some((d) =>
      fs.existsSync(path.join(d, "Scripts", "main.lua"))
    );
  } catch { return false; }
}
// Locate the bundled PSMBroadcast mod source (dev vs packaged, same as the chat mod).
function bundledBroadcastModDir() {
  const candidates = [
    path.join(process.cwd(), "psm-mods", "PSMBroadcast"),
    path.join(process.cwd(), "resources", "mods", "PSMBroadcast"),
    path.join(__dirname, "..", "resources", "mods", "PSMBroadcast"),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, "Scripts", "main.lua"))) return c; } catch {}
  }
  return null;
}
// Copy the bundled mod into the server's UE4SS Mods folder and bake in the absolute
// queue path so it doesn't depend on UE4SS's working directory.
function installBroadcastMod(installDir) {
  const src = bundledBroadcastModDir();
  if (!src) throw new Error("Bundled broadcast mod not found in this build.");
  const win64 = path.join(installDir, "Pal", "Binaries", "Win64");
  if (!fs.existsSync(win64)) throw new Error("Server binaries folder not found (Pal/Binaries/Win64).");
  const ue4ssPresent =
    fs.existsSync(path.join(win64, "ue4ss")) ||
    fs.existsSync(path.join(win64, "UE4SS.dll")) ||
    fs.existsSync(path.join(win64, "dwmapi.dll")) ||
    fs.existsSync(path.join(win64, "Mods"));
  const dst = broadcastModDir(installDir);
  copyDirInto(src, dst);

  const queuePath = broadcastQueuePath(installDir).replace(/\\/g, "/");
  const scriptPath = path.join(dst, "Scripts", "main.lua");
  try {
    const lua = fs.readFileSync(scriptPath, "utf8");
    fs.writeFileSync(scriptPath, lua.replace(/__PSM_QUEUE_PATH__/g, queuePath), "utf8");
  } catch {}

  try { fs.mkdirSync(path.dirname(broadcastQueuePath(installDir)), { recursive: true }); } catch {}

  // Remove any stale copy in a Mods folder this UE4SS build no longer scans.
  for (const cand of broadcastModCandidates(installDir)) {
    if (path.resolve(cand) !== path.resolve(dst)) {
      try { fs.rmSync(cand, { recursive: true, force: true }); } catch {}
    }
  }
  return { installed: true, dir: dst, ue4ssDetected: ue4ssPresent };
}
// Remove the broadcast mod from every location it could live.
function uninstallBroadcastMod(installDir) {
  let removed = false;
  for (const cand of broadcastModCandidates(installDir)) {
    try {
      if (fs.existsSync(cand)) { fs.rmSync(cand, { recursive: true, force: true }); removed = true; }
    } catch {}
  }
  return { removed };
}
// Append a message for the running PSMBroadcast mod to display on-screen. The message
// is base64-encoded so arbitrary text (quotes, newlines, unicode) survives the JSONL
// transport untouched. Only meaningful while the world runs — the mod seeks to the end
// of the queue on load, so anything queued before boot is intentionally skipped.
function enqueueBroadcast(installDir, message) {
  const file = broadcastQueuePath(installDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const b64 = Buffer.from(String(message), "utf8").toString("base64");
  fs.appendFileSync(file, JSON.stringify({ b64, at: Date.now() }) + "\n", "utf8");
}

function startChatTail(worldId, installDir) {
  stopChatTail(worldId);
  const file = chatFilePath(installDir);
  // Start reading from the current end of file so we don't replay old chat on restart.
  let offset = 0;
  try { offset = fs.existsSync(file) ? fs.statSync(file).size : 0; } catch { offset = 0; }
  const state = { offset };
  const tick = () => {
    try {
      if (!fs.existsSync(file)) return;
      const size = fs.statSync(file).size;
      if (size < state.offset) state.offset = 0; // file was truncated/rotated
      if (size === state.offset) return;
      const fd = fs.openSync(file, "r");
      const len = size - state.offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, state.offset);
      fs.closeSync(fd);
      state.offset = size;
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const chat = parseChatEntry(t);
        if (chat) recordChat(worldId, chat);
      }
    } catch {}
  };
  state.timer = setInterval(tick, 1000);
  S.chatTails.set(worldId, state);
}

function stopChatTail(worldId) {
  const state = S.chatTails.get(worldId);
  if (state && state.timer) clearInterval(state.timer);
  S.chatTails.delete(worldId);
}

// Parse one line from the chat file: prefer JSON (our mod), fall back to the legacy
// text parser so third-party ChatLogger-style logs also work.
function parseChatEntry(line) {
  if (line[0] === "{") {
    try {
      const o = JSON.parse(line);
      if (o && o.message) {
        // System/server broadcasts (player join/leave notices, admin announcements)
        // travel through the game's chat channel with no player sender. Palworld
        // localizes them to the server's game locale (often Japanese), and they just
        // duplicate the Join/Leave history — so keep them out of the player chat feed
        // and the Discord relay. Real player chat always carries a sender name.
        const sender = String(o.name || "").trim();
        if (!sender) return null;
        return { name: sender, message: String(o.message), channel: o.channel || null, at: o.at || Date.now() };
      }
    } catch {}
  }
  return parseChatLine(line);
}

function getChat(worldId) { return S.chat.get(worldId) || []; }
function subscribeChat(worldId, fn) {
  let set = S.chatListeners.get(worldId);
  if (!set) { set = new Set(); S.chatListeners.set(worldId, set); }
  set.add(fn);
  return () => set.delete(fn);
}

function getLogs(worldId) {
  return S.logs.get(worldId) || [];
}
function subscribe(worldId, fn) {
  let set = S.listeners.get(worldId);
  if (!set) { set = new Set(); S.listeners.set(worldId, set); }
  set.add(fn);
  return () => set.delete(fn);
}

function isRunning(worldId) {
  const child = S.procs.get(worldId);
  return !!child && !child.killed && child.exitCode === null;
}

function pidAlive(pid) {
  if (!pid) return false;
  // signal 0 just probes existence. ESRCH = no such process (dead). EPERM = the
  // process exists but isn't ours to signal — which happens on Windows for a server
  // this process didn't spawn (e.g. after the app restarted), so that counts as alive.
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// Like isRunning, but also true when we've lost the in-memory child handle (e.g. the
// app restarted while the world kept running) yet the recorded PID is still alive.
// Used by background delivery (scheduled broadcasts, warnings) so they don't silently
// treat a live server as offline after an app restart.
function isAlive(worldId) {
  if (isRunning(worldId)) return true;
  const w = dbm.getWorld(worldId);
  return !!(w && pidAlive(w.process_id));
}

async function startWorld(worldId) {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("World not found");
  if (isRunning(worldId)) return { started: false, reason: "already running" };

  const bin = serverBinary(world.install_dir);
  if (!fs.existsSync(bin)) throw new Error(`Server binary missing: ${bin}`);

  dbm.updateWorld(worldId, { status: "starting" });
  dbm.logEvent(worldId, "start", `Launching ${world.display_name}`);

  const args = buildArgs(world);
  pushLog(worldId, `Starting: ${path.basename(bin)} ${args.join(" ")}`);

  // On Linux the .sh needs to be executable
  try { if (os.platform() !== "win32") fs.chmodSync(bin, 0o755); } catch {}

  // Spawn options. On Windows, PalServer.exe launches the real shipping binary in
  // its own console window; windowsHide + detached + a hidden shell keep it hidden.
  const spawnOpts = {
    cwd: world.install_dir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (os.platform() === "win32") {
    // detached:true gives the child its own process group so we can still tree-kill
    // it, while windowsHide + CREATE_NO_WINDOW suppress the console window.
    spawnOpts.detached = true;
    spawnOpts.windowsHide = true;
  }

  const child = spawn(bin, args, spawnOpts);
  S.procs.set(worldId, child);
  dbm.updateWorld(worldId, {
    status: "running",
    process_id: child.pid,
    last_started_at: Date.now(),
  });

  child.stdout.on("data", (d) => splitLines(d).forEach((l) => pushLog(worldId, l)));
  child.stderr.on("data", (d) => splitLines(d).forEach((l) => pushLog(worldId, l)));
  // Tail the chat file produced by the PSMChatRelay mod (chat never hits stdout),
  // unless the user has turned the chat-capture feature off globally.
  if (dbm.getSetting("chatCaptureEnabled", true)) {
    startChatTail(worldId, world.install_dir);
  }
  child.on("close", (code) => {
    S.procs.delete(worldId);
    stopChatTail(worldId);
    const w = dbm.getWorld(worldId);
    pushLog(worldId, `Process exited with code ${code}`);
    // If we weren't intentionally stopping/updating, mark crashed.
    if (w && w.status !== "stopping" && w.status !== "updating") {
      dbm.updateWorld(worldId, { status: "crashed", process_id: null });
      dbm.logEvent(worldId, "crash", `Exited unexpectedly (code ${code})`);
      notify.notify(worldId, "crash", `${w.display_name} crashed (exited unexpectedly, code ${code})`);
    } else {
      dbm.updateWorld(worldId, { status: "stopped", process_id: null });
    }
  });

  ensureGuardian();
  return { started: true, pid: child.pid };
}

async function stopWorld(worldId, { graceful = true, waittime = 15 } = {}) {
  const world = dbm.getWorld(worldId);
  if (!world) throw new Error("World not found");
  dbm.updateWorld(worldId, { status: "stopping" });
  dbm.logEvent(worldId, "stop", `Stopping ${world.display_name}`);

  if (graceful && world.rest_api_enabled) {
    try {
      // NOTE: do NOT call rest.save() here. On shutdown Palworld re-serializes its
      // loaded config back to PalWorldSettings.ini; calling save() first makes it
      // persist the OLD in-memory settings and overwrite edits made while stopped.
      // shutdown() alone triggers a clean save of world data on exit.
      await rest.shutdown(world, waittime, "Server shutting down.");
    } catch { /* fall through to hard kill */ }
  }
  const child = S.procs.get(worldId);
  await new Promise((resolve) => {
    if (!child) return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    child.once("close", finish);
    // hard timeout
    setTimeout(() => {
      if (child.pid) kill(child.pid, "SIGKILL", () => {});
      setTimeout(finish, 1500);
    }, graceful ? (waittime + 5) * 1000 : 500);
  });
  S.procs.delete(worldId);
  dbm.updateWorld(worldId, { status: "stopped", process_id: null });
  // Give the OS a moment to flush the config file Palworld rewrites on exit,
  // so a subsequent start reads the fully-written ini.
  await new Promise((r) => setTimeout(r, 800));
  return { stopped: true };
}

async function restartWorld(worldId, { waittime = 5 } = {}) {
  // Capture the user's intended settings BEFORE stopping, because Palworld
  // rewrites PalWorldSettings.ini on exit and would otherwise clobber edits.
  const world = dbm.getWorld(worldId);
  let intendedIni = null;
  try {
    if (world) intendedIni = fs.readFileSync(ini.settingsIniPath(world.install_dir), "utf8");
  } catch {}

  await stopWorld(worldId, { graceful: true, waittime });
  await new Promise((r) => setTimeout(r, 1500));

  // Re-write the intended settings now that the old process has fully exited and
  // done its own exit-time config write. This makes edits actually persist.
  try {
    if (intendedIni && world) {
      fs.writeFileSync(ini.settingsIniPath(world.install_dir), intendedIni, "utf8");
      dbm.logEvent(worldId, "settings", "Re-applied saved settings after shutdown");
    }
  } catch {}

  return startWorld(worldId);
}

// ---- Crash guardian (spec §9) ----
function ensureGuardian() {
  if (S.guardTimer) return;
  S.guardTimer = setInterval(guardTick, 20000);
}
async function guardTick() {
  const worlds = dbm.listWorlds();
  for (const w of worlds) {
    if (!w.crash_guard) continue;
    if (w.status === "crashed") {
      // auto-relaunch after a crash
      dbm.updateWorld(w.world_id, { crash_count: (w.crash_count || 0) + 1 });
      dbm.logEvent(w.world_id, "guardian", "Crash detected — auto-restarting");
      try { await startWorld(w.world_id); } catch {}
      continue;
    }
    if (w.status === "running") {
      const alive = isRunning(w.world_id) || pidAlive(w.process_id);
      if (!alive) {
        dbm.updateWorld(w.world_id, { status: "crashed" });
        continue;
      }
      // process alive but API frozen for extended period → treat as hang
      if (w.rest_api_enabled) {
        const ok = await rest.healthy(w).catch(() => false);
        if (!ok) {
          const hangs = (S.__hang ||= new Map());
          const n = (hangs.get(w.world_id) || 0) + 1;
          hangs.set(w.world_id, n);
          if (n >= 6) { // ~2 min unresponsive
            hangs.set(w.world_id, 0);
            dbm.logEvent(w.world_id, "guardian", "API unresponsive — force restarting (hang)");
            try { await restartWorld(w.world_id); } catch {}
          }
        } else {
          (S.__hang ||= new Map()).set(w.world_id, 0);
        }
      }
    }
  }
}

function splitLines(buf) {
  return buf.toString("utf8").split(/\r?\n/).filter((l) => l.length);
}

module.exports = {
  serverBinary, buildArgs, startWorld, stopWorld, restartWorld,
  isRunning, isAlive, pidAlive, getLogs, subscribe, pushLog, ensureGuardian,
  getChat, subscribeChat, parseChatLine,
  chatModDir, chatModInstalled, chatFilePath, installChatMod, uninstallChatMod, bundledChatModDir,
  broadcastModDir, broadcastModInstalled, broadcastQueuePath, installBroadcastMod,
  uninstallBroadcastMod, bundledBroadcastModDir, enqueueBroadcast,
};
