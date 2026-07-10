// lib/ini.js
// Palworld stores everything on one line inside PalWorldSettings.ini:
//   OptionSettings=(Difficulty=None,DayTimeSpeedRate=1.000000,...,AdminPassword="x",...)
// This module parses that blob into a flat object, lets you edit keys, and
// re-serializes it. It also locates the correct ini path per OS (spec §2/§3/§14).
const fs = require("fs");
const path = require("path");
const os = require("os");

function serverConfigDir(installDir) {
  const flavor = os.platform() === "win32" ? "WindowsServer" : "LinuxServer";
  return path.join(installDir, "Pal", "Saved", "Config", flavor);
}
function settingsIniPath(installDir) {
  return path.join(serverConfigDir(installDir), "PalWorldSettings.ini");
}
function defaultIniPath(installDir) {
  // Shipped default template lives at install root.
  return path.join(installDir, "DefaultPalWorldSettings.ini");
}

// Parse OptionSettings=(...) into { key: value } preserving string quotes.
function parseOptionSettings(text) {
  const m = text.match(/OptionSettings=\((.*)\)/s);
  if (!m) return {};
  const inner = m[1];
  const result = {};
  let key = "", val = "", inKey = true, inQuotes = false, depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inKey) {
      if (c === "=") { inKey = false; }
      else key += c;
    } else {
      if (c === '"') { inQuotes = !inQuotes; val += c; }
      else if (c === "(" && !inQuotes) { depth++; val += c; }
      else if (c === ")" && !inQuotes) { depth--; val += c; }
      else if (c === "," && !inQuotes && depth === 0) {
        result[key.trim()] = val;
        key = ""; val = ""; inKey = true;
      } else val += c;
    }
  }
  if (key.trim()) result[key.trim()] = val;
  return result;
}

function serializeOptionSettings(obj) {
  const parts = Object.entries(obj).map(([k, v]) => `${k}=${v}`);
  return `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(${parts.join(",")})\n`;
}

function readSettings(installDir) {
  const p = settingsIniPath(installDir);
  let raw;
  if (fs.existsSync(p)) raw = fs.readFileSync(p, "utf8");
  else if (fs.existsSync(defaultIniPath(installDir)))
    raw = fs.readFileSync(defaultIniPath(installDir), "utf8");
  else return { path: p, exists: false, options: {} };
  return { path: p, exists: true, options: parseOptionSettings(raw) };
}

function writeSettings(installDir, options) {
  const p = settingsIniPath(installDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, serializeOptionSettings(options), "utf8");
  return p;
}

// Raw file access for the in-app text editor. Returns the exact bytes on disk
// (falling back to the shipped default template if the world's ini doesn't exist
// yet), so the editor round-trips comments and key order untouched.
function readRawSettings(installDir) {
  const p = settingsIniPath(installDir);
  if (fs.existsSync(p)) return { path: p, exists: true, content: fs.readFileSync(p, "utf8") };
  const dp = defaultIniPath(installDir);
  if (fs.existsSync(dp)) return { path: p, exists: false, content: fs.readFileSync(dp, "utf8") };
  return { path: p, exists: false, content: "" };
}
function writeRawSettings(installDir, content) {
  const p = settingsIniPath(installDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
  return p;
}

// Re-apply this world's own ports + password (spec §2 step 7, §3 step 6).
function applyWorldNetworkSettings(installDir, world) {
  const { options } = readSettings(installDir);
  options.PublicPort = String(world.game_port);
  options.RESTAPIPort = String(world.rest_api_port);
  options.RESTAPIEnabled = world.rest_api_enabled ? "True" : "False";
  // RCON is deprecated by Pocketpair and scheduled to stop functioning. Off by
  // default; only written when a world explicitly opts into legacy RCON.
  if (world.rcon_enabled) {
    options.RCONPort = String(world.rcon_port);
    options.RCONEnabled = "True";
  } else {
    options.RCONEnabled = "False";
  }
  options.AdminPassword = `"${world.admin_password || ""}"`;
  // Player join password. Empty string = open server (anyone can join).
  options.ServerPassword = `"${world.server_password || ""}"`;
  return writeSettings(installDir, options);
}

module.exports = {
  serverConfigDir, settingsIniPath, defaultIniPath,
  parseOptionSettings, serializeOptionSettings,
  readSettings, writeSettings, readRawSettings, writeRawSettings,
  applyWorldNetworkSettings,
};
