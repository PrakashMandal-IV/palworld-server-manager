import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const ini = require("@/lib/ini");
const AdmZip = require("adm-zip");
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Exports a world PROFILE (settings + customization + metadata) as a zip.
// Does NOT include the multi-GB save/install — this is for sharing config.
export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const s = ini.readSettings(w.install_dir, w.platform);
  const MANAGED = new Set(["PublicPort","RESTAPIPort","RESTAPIEnabled","RCONPort","RCONEnabled","AdminPassword","ServerPassword","PublicIP"]);
  const portable = {};
  for (const [k, v] of Object.entries(s.options)) if (!MANAGED.has(k)) portable[k] = v;

  const profile = {
    type: "palworld-world-profile",
    version: 1,
    exported: Date.now(),
    display_name: w.display_name,
    accent_color: w.accent_color || null,
    icon_data: w.icon_data || null,
    banner_data: w.banner_data || null,
    mods_enabled: !!w.mods_enabled,
    community_server: !!w.community_server,
    settings: portable,
  };

  const zip = new AdmZip();
  zip.addFile("world-profile.json", Buffer.from(JSON.stringify(profile, null, 2), "utf8"));
  zip.addFile("PalWorldSettings.portable.ini", Buffer.from(ini.serializeOptionSettings(portable), "utf8"));
  const buf = zip.toBuffer();
  const safe = (w.display_name || "world").replace(/[^a-z0-9_-]+/gi, "_");
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safe}_world.zip"`,
    },
  });
}
