// lib/restclient.js  (spec §14 official REST API surface)
// HTTP Basic Auth as admin / world's AdminPassword against 127.0.0.1:<rest_api_port>.
const http = require("http");

function req(world, method, apiPath, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const auth = Buffer.from(`admin:${world.admin_password || ""}`).toString("base64");
    const options = {
      host: "127.0.0.1",
      port: world.rest_api_port,
      path: `/v1/api/${apiPath}`,
      method,
      timeout: timeoutMs || 4000,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };
    const r = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(data ? JSON.parse(data) : {}); }
          catch { resolve({ raw: data }); }
        } else {
          reject(new Error(`REST ${res.statusCode}: ${data || res.statusMessage}`));
        }
      });
    });
    r.on("timeout", () => { r.destroy(new Error("REST timeout")); });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const rest = {
  info: (w) => req(w, "GET", "info"),
  players: (w) => req(w, "GET", "players"),
  settings: (w) => req(w, "GET", "settings"),
  metrics: (w) => req(w, "GET", "metrics"),
  announce: (w, message) => req(w, "POST", "announce", { message }),
  kick: (w, userid, message = "You have been kicked.") => req(w, "POST", "kick", { userid, message }),
  ban: (w, userid, message = "You have been banned.") => req(w, "POST", "ban", { userid, message }),
  unban: (w, userid) => req(w, "POST", "unban", { userid }),
  save: (w) => req(w, "POST", "save"),
  shutdown: (w, waittime = 30, message = "Server is shutting down.") =>
    req(w, "POST", "shutdown", { waittime, message }),
  stop: (w) => req(w, "POST", "stop"),
  // Liveness: does the REST API answer?
  async healthy(w) {
    try { await req(w, "GET", "info"); return true; } catch { return false; }
  },
  // Liveness with a reason and a caller-set timeout — the crash guardian uses this so a
  // failed probe can be logged (timeout vs ECONNREFUSED vs HTTP error) instead of being
  // swallowed, and so a momentarily-slow server isn't mistaken for a hang (issue #35).
  async health(w, timeoutMs) {
    try { await req(w, "GET", "info", null, timeoutMs); return { ok: true }; }
    catch (e) { return { ok: false, reason: (e && e.message) ? e.message : String(e) }; }
  },
};

module.exports = rest;
