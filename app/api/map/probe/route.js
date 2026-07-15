import { NextResponse } from "next/server";
const http = require("http");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Dev calibration helper: fetch the player list from a Palworld REST API the developer
// points at (host + port + admin password), so they can place reference points using
// live positions. Local dev tool — the app already talks to 127.0.0.1 REST endpoints.
function fetchPlayers({ host, port, password }) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`admin:${password || ""}`).toString("base64");
    const req = http.request(
      { host, port, path: "/v1/api/players", method: "GET", timeout: 6000,
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(d || "{}")); } catch { resolve({ raw: d }); }
          } else reject(new Error(`REST ${res.statusCode}: ${d || res.statusMessage}`));
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Connection timed out")));
    req.on("error", reject);
    req.end();
  });
}

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const host = String(b.host || "127.0.0.1").trim();
  const port = parseInt(b.port, 10);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ ok: false, error: "Valid host and port required" }, { status: 400 });
  }
  try {
    const r = await fetchPlayers({ host, port, password: b.password });
    return NextResponse.json({ ok: true, players: Array.isArray(r.players) ? r.players : [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
