import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const ini = require("@/lib/ini");
const AdmZip = require("adm-zip");
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MANAGED = new Set(["PublicPort","RESTAPIPort","RESTAPIEnabled","RCONPort","RCONEnabled","AdminPassword","ServerPassword","PublicIP"]);

export async function POST(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const { zipBase64, applyCustomization = true, applySettings = true } = await req.json();
  if (!zipBase64) return NextResponse.json({ ok: false, error: "No file" }, { status: 400 });

  let profile;
  try {
    const zip = new AdmZip(Buffer.from(zipBase64, "base64"));
    const entry = zip.getEntry("world-profile.json");
    if (entry) profile = JSON.parse(entry.getData().toString("utf8"));
    else {
      const iniEntry = zip.getEntries().find((e) => e.entryName.endsWith(".ini"));
      if (!iniEntry) return NextResponse.json({ ok: false, error: "No profile or ini in zip" }, { status: 400 });
      profile = { settings: ini.parseOptionSettings(iniEntry.getData().toString("utf8")) };
    }
  } catch (e) { return NextResponse.json({ ok: false, error: "Bad zip: " + e.message }, { status: 400 }); }

  // settings
  if (applySettings && profile.settings) {
    const cur = ini.readSettings(w.install_dir, w.platform).options;
    const merged = { ...cur };
    for (const [k, v] of Object.entries(profile.settings)) if (!MANAGED.has(k)) merged[k] = v;
    merged.PublicPort = String(w.game_port);
    merged.RESTAPIPort = String(w.rest_api_port);
    merged.RESTAPIEnabled = w.rest_api_enabled ? "True" : "False";
    merged.AdminPassword = `"${w.admin_password || ""}"`;
    merged.RCONEnabled = w.rcon_enabled ? "True" : "False";
    ini.writeSettings(w.install_dir, merged, w.platform);
  }
  // customization
  if (applyCustomization) {
    const patch = {};
    if (profile.icon_data !== undefined) patch.icon_data = profile.icon_data;
    if (profile.banner_data !== undefined) patch.banner_data = profile.banner_data;
    if (profile.accent_color !== undefined) patch.accent_color = profile.accent_color;
    if (profile.community_server !== undefined) patch.community_server = profile.community_server ? 1 : 0;
    if (Object.keys(patch).length) dbm.updateWorld(w.world_id, patch);
  }
  dbm.logEvent(w.world_id, "settings", "Imported world profile (restart to apply settings)");
  return NextResponse.json({ ok: true });
}
