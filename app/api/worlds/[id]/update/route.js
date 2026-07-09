import { NextResponse } from "next/server";
const { startUpdateJob } = require("@/lib/scheduler");
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(_req, { params }) {
  const jobId = startUpdateJob(params.id);
  if (!jobId) return NextResponse.json({ ok: false, error: "World not found" }, { status: 404 });
  return NextResponse.json({ ok: true, jobId });
}
