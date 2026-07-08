import { NextResponse } from "next/server";
const https = require("https");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST { webhook } -> sends a test message to the Discord webhook and reports
// the real result, so the Settings page can verify a webhook before saving.
export async function POST(req) {
  const { webhook } = await req.json().catch(() => ({}));
  const url = (webhook || "").trim();
  if (!url) {
    return NextResponse.json({ ok: false, error: "Enter a webhook URL first." }, { status: 400 });
  }

  let u;
  try {
    u = new URL(url);
  } catch {
    return NextResponse.json({ ok: false, error: "That is not a valid URL." }, { status: 400 });
  }
  if (u.protocol !== "https:" || !/(^|\.)discord(app)?\.com$/.test(u.hostname)) {
    return NextResponse.json({ ok: false, error: "Not a Discord webhook URL." }, { status: 400 });
  }

  const payload = JSON.stringify({
    content: "**[test]** ✅ Palworld Server Manager can reach this channel.",
  });

  const result = await new Promise((resolve) => {
    try {
      const r = https.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        }
      );
      r.on("error", (e) => resolve({ status: 0, body: e.message }));
      r.write(payload);
      r.end();
    } catch (e) {
      resolve({ status: 0, body: e.message });
    }
  });

  if (result.status >= 200 && result.status < 300) {
    return NextResponse.json({ ok: true });
  }
  let msg = `Discord returned ${result.status || "no response"}`;
  try {
    const j = JSON.parse(result.body);
    if (j.message) msg += ` — ${j.message}`;
  } catch {}
  return NextResponse.json({ ok: false, error: msg }, { status: 502 });
}
