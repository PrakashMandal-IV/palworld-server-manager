import { NextResponse } from "next/server";
const crypto = require("crypto");
const dbm = require("@/lib/db");
const { ensureScheduler } = require("@/lib/scheduler");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req, { params }) {
  return NextResponse.json({ ok: true, schedules: dbm.listSchedules(params.id) });
}

const JOB_TYPES = ["restart", "backup", "update", "system_message", "onscreen_notice"];
const MODES = ["interval", "daily", "minutes", "on_join"];
const MESSAGE_JOBS = ["system_message", "onscreen_notice"];

export async function POST(req, { params }) {
  const b = await req.json();
  const job_type = String(b.job_type || "");
  const mode = String(b.mode || "");
  if (!JOB_TYPES.includes(job_type)) return NextResponse.json({ ok: false, error: "Invalid job type." }, { status: 400 });
  if (!MODES.includes(mode)) return NextResponse.json({ ok: false, error: "Invalid schedule mode." }, { status: 400 });

  const isMessageJob = MESSAGE_JOBS.includes(job_type);
  const message = String(b.message ?? "").trim();
  if (isMessageJob && !message) return NextResponse.json({ ok: false, error: "A message is required for message jobs." }, { status: 400 });
  // on_join only makes sense for the message jobs (there's a player to greet).
  if (mode === "on_join" && !isMessageJob) return NextResponse.json({ ok: false, error: "The join trigger is only available for message jobs." }, { status: 400 });

  const interval_hours = mode === "interval" ? Math.max(1, Number(b.interval_hours) || 0) : null;
  const interval_minutes = mode === "minutes" ? Math.max(1, Number(b.interval_minutes) || 0) : null;
  const time_of_day = mode === "daily" ? (b.time_of_day ?? null) : null;
  if (mode === "interval" && !interval_hours) return NextResponse.json({ ok: false, error: "Interval hours must be at least 1." }, { status: 400 });
  if (mode === "minutes" && !interval_minutes) return NextResponse.json({ ok: false, error: "Interval minutes must be at least 1." }, { status: 400 });
  if (mode === "daily" && !/^\d{1,2}:\d{2}$/.test(String(time_of_day || ""))) return NextResponse.json({ ok: false, error: "A valid time is required for a daily schedule." }, { status: 400 });

  const s = {
    id: crypto.randomUUID(),
    world_id: params.id,
    job_type,
    mode,
    interval_hours,
    interval_minutes,
    time_of_day,
    message: isMessageJob ? message : null,
    join_match: mode === "on_join" ? (String(b.join_match ?? "").trim() || null) : null,
    enabled: b.enabled === false ? 0 : 1,
    created_at: Date.now(),
  };
  dbm.insertSchedule(s);
  ensureScheduler();
  return NextResponse.json({ ok: true, schedule: s });
}

export async function DELETE(req, { params }) {
  const id = new URL(req.url).searchParams.get("sid");
  if (id) dbm.deleteSchedule(id);
  return NextResponse.json({ ok: true });
}
