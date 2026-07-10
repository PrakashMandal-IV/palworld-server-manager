import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const ini = require("@/lib/ini");
const sup = require("@/lib/supervisor");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: the raw PalWorldSettings.ini text for the in-app editor.
export async function GET(_req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const r = ini.readRawSettings(w.install_dir);
  return NextResponse.json({
    ok: true, path: r.path, exists: r.exists, content: r.content,
    running: sup.isRunning(w.world_id),
  });
}

// POST { content }: snapshot the current file into history, then overwrite it.
export async function POST(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const { content } = await req.json();
  if (typeof content !== "string") {
    return NextResponse.json({ ok: false, error: "content required" }, { status: 400 });
  }
  // Snapshot what's currently on disk so this save can always be undone.
  const cur = ini.readRawSettings(w.install_dir);
  if (cur.exists && cur.content) dbm.insertIniVersion(w.world_id, cur.content, "before edit");
  const path = ini.writeRawSettings(w.install_dir, content);
  // Also snapshot the newly-saved content so it appears in history as a restorable point.
  dbm.insertIniVersion(w.world_id, content, "saved");
  dbm.logEvent(w.world_id, "settings", "Edited PalWorldSettings.ini in the in-app editor (restart to apply)");
  return NextResponse.json({ ok: true, path, running: sup.isRunning(w.world_id) });
}
