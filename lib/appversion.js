// lib/appversion.js
// Checks GitHub for the latest app release and reports whether a newer version is
// out. The app never self-updates (it ships as a packaged Electron build) — this
// only surfaces "an update is available" so the UI can link to the release.
//
// Shared by the /api/app/version route (serves the cached result) and the
// scheduler's background poller (refreshes it every 30 min so the check happens
// even with no page open).
const https = require("https");
const fs = require("fs");
const path = require("path");

const REPO = "PrakashMandal-IV/palworld-server-manager";
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

// How long a fetched release is trusted before we look again. The scheduler polls
// on this cadence; a navigation that lands after it just reuses the cache.
const TTL = 30 * 60 * 1000; // 30 min

const g = globalThis;
if (!g.__PAL_APPVER) g.__PAL_APPVER = { at: 0, data: null };

// Current app version: injected by Electron (app.getVersion()), else package.json.
function currentVersion() {
  if (process.env.PALWORLD_APP_VERSION) return process.env.PALWORLD_APP_VERSION;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch { return "0.0.0"; }
}

// Compare dotted numeric versions. Returns 1 if a>b, -1 if a<b, 0 if equal.
function cmp(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "palworld-server-manager", Accept: "application/vnd.github+json" },
      timeout: 6000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        return getJson(res.headers.location).then(resolve, reject);
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`GitHub ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// Fetch the latest release from GitHub and store it in the shared cache. Always
// resolves — on failure it caches a "not checked" marker and shortens the next
// retry to ~5 min instead of holding the failure for the full TTL.
async function refresh(now = Date.now()) {
  try {
    const rel = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const latest = (rel.tag_name || "").replace(/^v/, "");
    const assets = (rel.assets || [])
      .filter((a) => /\.(exe|AppImage)$/i.test(a.name))
      .map((a) => ({ name: a.name, url: a.browser_download_url }));
    const data = { latest, releaseUrl: rel.html_url || RELEASES_URL, assets, checked: true };
    g.__PAL_APPVER = { at: now, data };
    return data;
  } catch {
    const data = { latest: null, releaseUrl: RELEASES_URL, assets: [], checked: false };
    g.__PAL_APPVER = { at: now - TTL + 5 * 60 * 1000, data };
    return data;
  }
}

// Return the app-version status, refreshing from GitHub if the cache is stale.
// updateAvailable is derived fresh each call so it stays correct even when the app
// version changes without a new fetch.
async function getStatus() {
  const now = Date.now();
  let data = g.__PAL_APPVER.data;
  if (!data || now - g.__PAL_APPVER.at >= TTL) data = await refresh(now);
  const current = currentVersion();
  const updateAvailable = !!data.latest && cmp(data.latest, current) > 0;
  return { current, latest: data.latest, releaseUrl: data.releaseUrl, assets: data.assets, checked: data.checked, updateAvailable };
}

// Refresh only if the cache is older than the TTL. Used by the background poller so
// it never hammers GitHub if a route already refreshed recently.
async function refreshIfStale(now = Date.now()) {
  if (!g.__PAL_APPVER.data || now - g.__PAL_APPVER.at >= TTL) return refresh(now);
  return g.__PAL_APPVER.data;
}

module.exports = { getStatus, refresh, refreshIfStale, currentVersion, cmp, TTL, RELEASES_URL };
