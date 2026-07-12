import { NextResponse } from "next/server";
const { lanAddresses } = require("@/lib/netinfo");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, lan: lanAddresses() });
}
