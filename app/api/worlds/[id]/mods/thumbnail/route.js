import { NextResponse } from "next/server";
const fs = require("fs");
const path = require("path");
const mods = require("@/lib/mods");
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

// GET ?folder=<workshop folder> — serve a mod's preview image. The renderer has no
// disk access, so mod art has to come back through the server. 404 (not an error
// page) when a mod ships no thumbnail: the UI just falls back to its icon.
export async function GET(req, { params }) {
  const folder = new URL(req.url).searchParams.get("folder");
  if (!folder) return NextResponse.json({ ok: false, error: "folder required" }, { status: 400 });
  try {
    const file = mods.modThumbnailPath(params.id, folder);
    if (!file || !fs.existsSync(file)) return new NextResponse(null, { status: 404 });
    const body = fs.readFileSync(file);
    return new NextResponse(body, {
      headers: {
        "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        // Mod art only changes when the mod itself is updated, and the folder is
        // stable — revalidate rather than pinning a stale image after an update.
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
