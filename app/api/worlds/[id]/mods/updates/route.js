import { NextResponse } from "next/server";
const mods = require("@/lib/mods");
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — compare each installed mod's Info.json Version against Steam's copy of the
// same Workshop item. Read-only: nothing is copied until the user asks.
export async function GET(_req, { params }) {
  try { return NextResponse.json({ ok: true, checked: Date.now(), updates: mods.checkWorkshopUpdates(params.id) }); }
  catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}

// POST { folder } — re-copy that one mod from Steam. POST {} — re-copy every mod
// that a fresh check says is out of date.
export async function POST(req, { params }) {
  try {
    const { folder } = await req.json().catch(() => ({}));
    if (folder) {
      const result = mods.updateWorkshopMod(params.id, folder);
      return NextResponse.json({ ok: true, results: [result], ...mods.status(params.id) });
    }
    const stale = mods.checkWorkshopUpdates(params.id).filter((u) => u.updateAvailable);
    const results = [];
    for (const u of stale) {
      // One bad mod shouldn't abort the rest of the batch — record it and continue.
      try { results.push({ ...mods.updateWorkshopMod(params.id, u.folder), ok: true }); }
      catch (e) { results.push({ folder: u.folder, packageName: u.packageName, ok: false, error: e.message }); }
    }
    return NextResponse.json({ ok: true, results, ...mods.status(params.id) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
