import { NextResponse } from "next/server";
const https = require("https");
const fs = require("fs");
const path = require("path");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REPO = "PrakashMandal-IV/palworld-server-manager";
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

// Current app version: injected by Electron (app.getVersion()), else read package.json.
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

// Cache the GitHub lookup so we don't hit the API on every navigation.
const g = globalThis;
if (!g.__PAL_APPVER) g.__PAL_APPVER = { at: 0, data: null };
const TTL = 60 * 60 * 1000; // 1 hour

export async function GET() {
  const current = currentVersion();
  const now = Date.now();

  // Cache only the GitHub release data; updateAvailable is derived fresh each call so
  // it stays correct even if the app version changes without a new GitHub fetch.
  let data = g.__PAL_APPVER.data;
  if (!data || now - g.__PAL_APPVER.at >= TTL) {
    try {
      const rel = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
      const latest = (rel.tag_name || "").replace(/^v/, "");
      const assets = (rel.assets || [])
        .filter((a) => /\.(exe|AppImage)$/i.test(a.name))
        .map((a) => ({ name: a.name, url: a.browser_download_url }));
      data = { latest, releaseUrl: rel.html_url || RELEASES_URL, assets, checked: true };
      g.__PAL_APPVER = { at: now, data };
    } catch {
      data = { latest: null, releaseUrl: RELEASES_URL, assets: [], checked: false };
      // retry in ~5 min rather than caching the failure for the full hour
      g.__PAL_APPVER = { at: now - TTL + 5 * 60 * 1000, data };
    }
  }

  const updateAvailable = !!data.latest && cmp(data.latest, current) > 0;
  const { latest, releaseUrl, assets, checked } = data;
  return NextResponse.json({ ok: true, current, latest, releaseUrl, assets, checked, updateAvailable });
}
