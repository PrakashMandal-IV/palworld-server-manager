import { NextResponse } from "next/server";
const appver = require("@/lib/appversion");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Serves the app-version status from the shared cache in lib/appversion.js, which
// the scheduler also refreshes on a 30-minute background poll. The app never
// self-updates — this only tells the UI whether a newer GitHub release exists.
export async function GET() {
  const status = await appver.getStatus();
  return NextResponse.json({ ok: true, ...status });
}
