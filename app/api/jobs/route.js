import { NextResponse } from "next/server";
const jobs = require("@/lib/jobs");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Downloads tray polls this for all active + recently-finished install/update jobs.
export async function GET() {
  return NextResponse.json({ ok: true, jobs: jobs.listJobs() });
}
