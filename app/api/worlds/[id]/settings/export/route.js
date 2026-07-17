import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const ini = require("@/lib/ini");
const AdmZip = require("adm-zip");
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const s = ini.readSettings(w.install_dir, w.platform);
  // strip managed/identity keys so shared settings are portable
  const MANAGED = new Set(["PublicPort","RESTAPIPort","RESTAPIEnabled","RCONPort","RCONEnabled","AdminPassword","ServerPassword","PublicIP"]);
  const portable = {};
  for (const [k, v] of Object.entries(s.options)) if (!MANAGED.has(k)) portable[k] = v;

  const zip = new AdmZip();
  zip.addFile("PalWorldSettings.portable.ini", Buffer.from(ini.serializeOptionSettings(portable), "utf8"));
  zip.addFile("meta.json", Buffer.from(JSON.stringify({ type: "palworld-settings", exported: Date.now(), from: w.display_name, keys: Object.keys(portable).length }, null, 2), "utf8"));
  const buf = zip.toBuffer();
  const safe = (w.display_name || "world").replace(/[^a-z0-9_-]+/gi, "_");
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safe}_settings.zip"`,
    },
  });
}
