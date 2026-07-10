import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const ini = require("@/lib/ini");
const { GROUPS } = require("@/lib/palfields");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Keys the app manages itself — never surfaced to the editor, always re-applied
// from the world record so the editor can't break the world's identity.
const MANAGED = new Set([
  "PublicPort", "RESTAPIPort", "RESTAPIEnabled", "RCONPort", "RCONEnabled",
  "AdminPassword", "ServerPassword", "PublicIP",
]);

export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const s = ini.readSettings(w.install_dir);
  // Report which keys are actually present in the ini so the editor can show
  // "set" vs "default (not written)" and only save real changes.
  const presentKeys = Object.keys(s.options).filter((k) => !MANAGED.has(k));
  return NextResponse.json({
    ok: true, path: s.path, exists: s.exists,
    options: s.options, presentKeys, groups: GROUPS,
  });
}

export async function POST(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // The editor sends ONLY the keys the user actually changed (`changed`), plus
  // the full set it's aware of is irrelevant — we merge changes onto the CURRENT
  // ini so untouched settings (and any keys the editor doesn't know about) are
  // preserved exactly as Palworld wrote them.
  const body = await req.json();
  const changed = body.changed || body.options || {};

  const cur = ini.readSettings(w.install_dir).options; // real current ini (source of truth)
  const merged = { ...cur };

  // apply only changed, non-managed keys
  for (const [k, v] of Object.entries(changed)) {
    if (MANAGED.has(k)) continue;
    if (v === undefined || v === null) continue;
    merged[k] = v;
  }

  // re-apply managed network/auth identity from the world record
  merged.PublicPort = String(w.game_port);
  merged.RESTAPIPort = String(w.rest_api_port);
  merged.RESTAPIEnabled = w.rest_api_enabled ? "True" : "False";
  merged.AdminPassword = `"${w.admin_password || ""}"`;
  merged.ServerPassword = `"${w.server_password || ""}"`;
  if (w.rcon_enabled) { merged.RCONPort = String(w.rcon_port); merged.RCONEnabled = "True"; }
  else merged.RCONEnabled = "False";

  const path = ini.writeSettings(w.install_dir, merged);
  dbm.logEvent(w.world_id, "settings", `Saved ${Object.keys(changed).length} change(s) to PalWorldSettings.ini (restart to apply)`);
  return NextResponse.json({ ok: true, path, written: Object.keys(merged).length });
}
