import { NextResponse } from "next/server";
const fs = require("fs");
const path = require("path");
const dbm = require("@/lib/db");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Map calibration has two layers:
//
//  BAKED (global)  public/map/calibration.json — ships with the app. The developer
//                  sets it once (Settings > Developer > Calibrate map) and commits
//                  it, so every install gets an accurate map with zero setup.
//  USER (local)    app_settings.mapCalibration — if someone calibrates on their own
//                  Map tab it overrides the baked one FOR THEM ONLY. Resetting
//                  clears it and falls back to the shipped global calibration.
//
// Each point: {x,y} = a player's REST location_x/location_y, {nx,ny} = that player's
// real 0..1 position on the map image.
const FILE = path.join(process.cwd(), "public", "map", "calibration.json");
const KEY = "mapCalibration";
const clamp = (v) => Math.max(0, Math.min(1, v));
const num = (v) => typeof v === "number" && Number.isFinite(v);

function cleanPoints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && num(p.x) && num(p.y) && num(p.nx) && num(p.ny))
    .map((p) => ({ x: p.x, y: p.y, nx: clamp(p.nx), ny: clamp(p.ny) }))
    .slice(0, 50);
}

function readBaked() {
  try { return cleanPoints(JSON.parse(fs.readFileSync(FILE, "utf8")).points); }
  catch { return []; }
}

// The user's local override (empty = use the baked global one).
export async function GET() {
  return NextResponse.json({ ok: true, points: cleanPoints(dbm.getSetting(KEY, [])), baked: readBaked() });
}

// POST { points, scope }
//   scope "baked" -> write the shipped file (developer, dev-time only)
//   otherwise     -> save as this user's local override
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!Array.isArray(b.points)) {
    return NextResponse.json({ ok: false, error: "points array required" }, { status: 400 });
  }
  const pts = cleanPoints(b.points);

  if (b.scope === "baked") {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({ schema: 1, updatedAt: new Date().toISOString(), points: pts }, null, 2));
    } catch (e) {
      // Only writable at dev time — the file is packaged read-only in a release build.
      return NextResponse.json({ ok: false, error: "Could not write calibration file (dev-time only): " + e.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, scope: "baked", points: pts });
  }

  dbm.setSetting(KEY, pts);
  return NextResponse.json({ ok: true, scope: "user", points: pts });
}

// Drop this user's override, falling back to the shipped global calibration.
export async function DELETE() {
  dbm.setSetting(KEY, []);
  return NextResponse.json({ ok: true, points: [], baked: readBaked() });
}
