import { NextResponse } from "next/server";
const fs = require("fs");
const path = require("path");
const { getText } = require("@/lib/i18n/fetch");
const { allPacks, BASE } = require("@/lib/i18n/loader");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/i18n/registry — the community language-pack catalog.
//
// Fetches registry/index.json from the repo (30-min TTL cache), validates every
// entry defensively, and cross-references locally installed packs so the UI can
// render Install / Installed / Update per language. The catalog is a DISCOVERY
// layer only: installing still goes through POST /api/i18n/download, which runs
// the full untrusted-pack validator. A tampered index can therefore point the UI
// at a pack, but never bypass validation — and the host allowlist below stops it
// from pointing the app at arbitrary (e.g. internal) hosts at all.

const REGISTRY_URL =
  process.env.PAL_I18N_REGISTRY_URL ||
  "https://raw.githubusercontent.com/PrakashMandal-IV/palworld-server-manager/main/registry/index.json";
const TTL = 30 * 60 * 1000; // re-fetch the index at most every 30 min
const MAX_ENTRIES = 500;
const CODE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

// Hosts a pack `url` may live on. The index itself is a fixed constant, but its
// entries are data — never let them steer downloads to arbitrary hosts.
const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "github.com",
]);
try { ALLOWED_HOSTS.add(new URL(REGISTRY_URL).hostname); } catch {}

const asString = (x, max = 200) => (typeof x === "string" ? x.trim().slice(0, max) : "");

// Whitelist one raw index entry → clean object, or null to drop it.
function cleanEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const code = asString(raw.code, 8);
  if (!CODE_RE.test(code) || code === BASE) return null;
  let parsed;
  try { parsed = new URL(asString(raw.url, 500)); } catch { return null; }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) return null;
  const completeness = Number(raw.completeness);
  return {
    code,
    name: asString(raw.name, 60) || code,
    nativeName: asString(raw.nativeName, 60) || asString(raw.name, 60) || code,
    dir: raw.dir === "rtl" ? "rtl" : "ltr",
    authors: Array.isArray(raw.authors)
      ? raw.authors.filter((a) => typeof a === "string").map((a) => a.slice(0, 60)).slice(0, 20)
      : [],
    url: parsed.toString(),
    updatedAt: asString(raw.updatedAt, 32),
    completeness: Number.isFinite(completeness) ? Math.max(0, Math.min(100, Math.round(completeness))) : null,
    appMinVersion: asString(raw.appMinVersion, 20),
  };
}

function validateIndex(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== "object" || raw.schema !== 1 || !Array.isArray(raw.packs)) return null;
  const seen = new Set();
  const packs = [];
  for (const entry of raw.packs.slice(0, MAX_ENTRIES)) {
    const clean = cleanEntry(entry);
    if (!clean || seen.has(clean.code)) continue; // drop malformed/dupes, keep the rest
    seen.add(clean.code);
    packs.push(clean);
  }
  return packs;
}

// Current app version (same sources as the version route) so packs that declare
// appMinVersion can be greyed out server-side — the UI never has to compare versions.
function currentVersion() {
  if (process.env.PALWORLD_APP_VERSION) return process.env.PALWORLD_APP_VERSION;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch { return "0.0.0"; }
}

function cmp(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Cache the index like the version route caches the GitHub release lookup.
const g = globalThis;
if (!g.__PAL_I18N_REG) g.__PAL_I18N_REG = { at: 0, packs: null };

export async function GET() {
  const cache = g.__PAL_I18N_REG;
  if (!cache.packs || Date.now() - cache.at > TTL) {
    try {
      const packs = validateIndex(await getText(REGISTRY_URL));
      if (packs) { cache.packs = packs; cache.at = Date.now(); }
    } catch {
      /* offline / unreachable — fall through to whatever we have */
    }
  }

  if (!cache.packs) {
    // Couldn't reach the catalog and have nothing cached: degrade gracefully —
    // the UI falls back to "paste a URL / import a file".
    return NextResponse.json({ ok: true, checked: false, packs: [] });
  }

  // Cross-reference installed packs for Install / Installed / Update state.
  const installed = allPacks();
  const appVersion = currentVersion();
  const packs = cache.packs.map((entry) => {
    const local = installed.get(entry.code);
    const localStamp = local ? asString(local.meta && local.meta.updatedAt, 32) : "";
    return {
      ...entry,
      installed: !!local,
      // Only flag an update when both sides carry a date and the catalog's is
      // newer (ISO date strings compare correctly as strings).
      updateAvailable: !!local && !!entry.updatedAt && !!localStamp && localStamp < entry.updatedAt,
      // Pack requires a newer app than the one running.
      unsupported: !!entry.appMinVersion && cmp(appVersion, entry.appMinVersion) < 0,
    };
  });
  return NextResponse.json({ ok: true, checked: true, packs });
}
