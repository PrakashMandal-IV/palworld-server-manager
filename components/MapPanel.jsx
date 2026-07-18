"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";

// ---------------------------------------------------------------------------
// Live player map. The Palworld REST API (/v1/api/players) returns each online
// player's world position as location_x / location_y — the same numbers the
// Players tab shows. We plot them on the bundled Palworld world map.
//
// Placing a dot means mapping world (x,y) -> a 0..1 position on the image. That
// transform is CALIBRATED by the user: they click where a live player really is,
// at 3+ spread-out spots, and we solve an affine fit (which absorbs any rotation
// or non-uniform framing). Until calibrated, DEFAULT_CAL is a decent axis-aligned
// guess solved from two Palpagos reference points.
const DEFAULT_CAL = { nxM: 7.492e-7, nxB: 0.4461, nyM: -7.512e-7, nyB: 0.2945 };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// In-game "compass" coordinate players recognise, for the hover tooltip.
const mapCoord = (x, y) => ({
  mx: Math.round((x + 122500) / 458.355),
  my: Math.round((y - 158100) / 458.355),
});

// ---- affine calibration from clicked points -------------------------------
// Least-squares fit of  v = a*x + b*y + c  over the points (v is nx or ny).
function fitPlane(pts, val) {
  let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0, S1 = 0, bx = 0, by = 0, b1 = 0;
  for (const p of pts) {
    const x = p.x, y = p.y, v = val(p);
    Sxx += x * x; Sxy += x * y; Sx += x; Syy += y * y; Sy += y; S1 += 1;
    bx += v * x; by += v * y; b1 += v;
  }
  return solve3([[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, S1]], [bx, by, b1]);
}
const det3 = (m) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
function solve3(M, r) {
  const d = det3(M);
  if (Math.abs(d) < 1e-9) return null;
  const col = (i, v) => M.map((row, k) => row.map((c, j) => (j === i ? v[k] : c)));
  return [det3(col(0, r)) / d, det3(col(1, r)) / d, det3(col(2, r)) / d];
}
// Build a project(x,y)->{nx,ny} from >=3 calibration points, or null. Coords are
// scaled down (they're ~1e5–1e6) so the normal equations stay well-conditioned.
function buildTransform(points) {
  if (!points || points.length < 3) return null;
  const S = 1e-6;
  const P = points.map((p) => ({ x: p.x * S, y: p.y * S, nx: p.nx, ny: p.ny }));
  const cx = fitPlane(P, (p) => p.nx);
  const cy = fitPlane(P, (p) => p.ny);
  if (!cx || !cy) return null;
  return (x, y) => ({
    nx: clamp01(cx[0] * x * S + cx[1] * y * S + cx[2]),
    ny: clamp01(cy[0] * x * S + cy[1] * y * S + cy[2]),
  });
}

// A small deterministic accent colour per player so dots stay stable across polls.
function dotColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 55%)`;
}
const pkey = (p) => String(p.userId || p.playerId || p.name || "");

const MAX_ZOOM = 8;
const zoomBtn = {
  width: 30, height: 30, padding: 0, fontSize: "1.1rem", fontWeight: 900, lineHeight: 1,
  background: "rgba(0,0,0,0.6)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)",
  display: "grid", placeItems: "center",
};
// Keep the panned image from being dragged off the viewport (transform-origin 0 0).
function clampPan(pan, zoom, W) {
  const min = -(zoom - 1) * W;
  const c = (v) => Math.min(0, Math.max(min, v));
  return { x: c(pan.x), y: c(pan.y) };
}

export default function MapPanel({ players, running, devCalibrate = false }) {
  const { t } = useTranslation();
  const [raster, setRaster] = useState(null); // null=checking, url=use it, false=drawn fallback
  const [hover, setHover] = useState(null);
  const [baked, setBaked] = useState([]);   // global calibration shipped with the app
  const [userPts, setUserPts] = useState([]); // this install's local override (wins if set)
  const [calibrating, setCalibrating] = useState(false);
  const [calUid, setCalUid] = useState(""); // player being placed
  const [pending, setPending] = useState([]); // points collected this session
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const mapRef = useRef(null);
  const viewRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const drag = useRef(null);
  useEffect(() => { viewRef.current = { zoom, pan }; }, [zoom, pan]);

  // Wheel zoom toward the cursor (native listener so we can preventDefault).
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const { zoom: z, pan: p } = viewRef.current;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const nz = Math.min(MAX_ZOOM, Math.max(1, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      const ux = (cx - p.x) / z, uy = (cy - p.y) / z;
      setZoom(nz);
      setPan(clampPan({ x: cx - ux * nz, y: cy - uy * nz }, nz, el.clientWidth));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (f) => {
    const el = mapRef.current; if (!el) return;
    const W = el.clientWidth; const { zoom: z, pan: p } = viewRef.current;
    const nz = Math.min(MAX_ZOOM, Math.max(1, z * f));
    const cx = W / 2, cy = W / 2;
    const ux = (cx - p.x) / z, uy = (cy - p.y) / z;
    setZoom(nz); setPan(clampPan({ x: cx - ux * nz, y: cy - uy * nz }, nz, W));
  };
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setRaster("/map/palworld-map.jpg");
    img.onerror = () => setRaster(false);
    img.src = "/map/palworld-map.jpg";
    // Global calibration ships as a static file, so every install gets it for free.
    fetch("/map/calibration.json?t=" + Date.now())
      .then((r) => (r.ok ? r.json() : { points: [] }))
      .then((j) => setBaked(Array.isArray(j.points) ? j.points : []))
      .catch(() => {});
    // A local override, if this user calibrated the map themselves.
    api("/api/map").then((r) => setUserPts(r.points || [])).catch(() => {});
  }, []);

  const list = players?.players || [];
  const located = useMemo(
    () => list.filter((p) => typeof p.location_x === "number" && typeof p.location_y === "number"),
    [list]
  );
  const unlocated = list.length - located.length;

  // A local override wins for this user; otherwise everyone gets the shipped global.
  const hasOverride = userPts.length >= 3;
  const effective = hasOverride ? userPts : baked;
  const transform = useMemo(() => buildTransform(effective), [effective]);
  const project = (x, y) =>
    transform ? transform(x, y) : { nx: clamp01(DEFAULT_CAL.nxM * y + DEFAULT_CAL.nxB), ny: clamp01(DEFAULT_CAL.nyM * x + DEFAULT_CAL.nyB) };

  // Default the calibration player to the first located one.
  useEffect(() => {
    if (calibrating && !calUid && located[0]) setCalUid(pkey(located[0]));
  }, [calibrating, calUid, located]);

  // Drag to pan; a click that didn't drag drops a calibration point (when calibrating).
  const onDown = (e) => { drag.current = { sx: e.clientX, sy: e.clientY, panx: pan.x, pany: pan.y, moved: false }; };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setPan(clampPan({ x: d.panx + dx, y: d.pany + dy }, viewRef.current.zoom, mapRef.current.clientWidth));
  };
  const onUp = (e) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved || !calibrating) return;
    const pl = located.find((p) => pkey(p) === calUid);
    if (!pl) { toast(t("map.calPickPlayer"), "error"); return; }
    const rect = mapRef.current.getBoundingClientRect();
    const { zoom: z, pan: p } = viewRef.current;
    const nx = clamp01(((e.clientX - rect.left) - p.x) / z / rect.width);
    const ny = clamp01(((e.clientY - rect.top) - p.y) / z / rect.height);
    setPending((pd) => [...pd, { x: pl.location_x, y: pl.location_y, nx, ny }]);
  };

  // The developer tool bakes the global calibration; anyone else saves a local
  // override that affects only their own install.
  const saveCalibration = async () => {
    try {
      const scope = devCalibrate ? "baked" : "user";
      const r = await api("/api/map", { method: "POST", body: { points: pending, scope } });
      if (scope === "baked") setBaked(r.points || []); else setUserPts(r.points || []);
      setPending([]); setCalibrating(false);
      toast(t(scope === "baked" ? "map.calSavedGlobal" : "map.calSaved"), "success");
    } catch (e) { toast(e.message, "error"); }
  };
  // Drop the local override -> back to the calibration the app shipped with.
  const resetCalibration = async () => {
    try {
      await api("/api/map", { method: "DELETE" });
      setUserPts([]); setPending([]);
      toast(t("map.calReset"), "success");
    } catch (e) { toast(e.message, "error"); }
  };

  const calReady = pending.length >= 3;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", margin: 0 }}>{t("map.title")}</h3>
        <span className="chip" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
          <Icon name="users" size={13} /> {t("map.online", { count: located.length })}
        </span>
        {running && located.length > 0 && (
          <span className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem" }}>
            <span className="statdot bg-running animate-pulseDot" /> {t("map.live")}
          </span>
        )}
        {!calibrating && (
          <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: "0.3rem 0.6rem", fontSize: "0.76rem" }}
            onClick={() => setCalibrating(true)} title={t("map.calDesc")}>
            <Icon name="pin" size={13} /> {t("map.calibrate")}
          </button>
        )}
      </div>

      {calibrating && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--accent)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.88rem", marginBottom: 4 }}>{t("map.calTitle")}</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.76rem", margin: "0 0 0.7rem" }}>{t("map.calDesc")}</p>
          {located.length === 0 ? (
            <p style={{ color: "var(--yellow)", fontWeight: 700, fontSize: "0.78rem", margin: 0 }}>{t("map.calNoPlayers")}</p>
          ) : (
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
              <label className="label" style={{ margin: 0 }}>{t("map.calPlayer")}</label>
              <select className="input" style={{ width: 180 }} value={calUid} onChange={(e) => setCalUid(e.target.value)}>
                {located.map((p) => <option key={pkey(p)} value={pkey(p)}>{p.name}</option>)}
              </select>
              <span className="chip" style={{ background: "var(--card-2)", border: "1px solid var(--line)", fontWeight: 700 }}>
                {t("map.calPointsSet", { count: pending.length })}
              </span>
              <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={() => setPending((p) => p.slice(0, -1))} disabled={!pending.length}>{t("map.calUndo")}</button>
              <button className="btn btn-primary" style={{ padding: "0.3rem 0.7rem" }} onClick={saveCalibration} disabled={!calReady}>
                <Icon name="check" size={14} /> {t("map.calSave")}
              </button>
              <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={() => { setPending([]); setCalibrating(false); }}>{t("map.calCancel")}</button>
              {!calReady && <span className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem" }}>{t("map.calNeedMore")}</span>}
            </div>
          )}
        </div>
      )}

      <div
        ref={mapRef}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => { drag.current = null; }}
        style={{
          position: "relative", width: "100%", maxWidth: 640, margin: "0 auto",
          aspectRatio: "1 / 1", borderRadius: 14, overflow: "hidden",
          border: `1px solid ${calibrating ? "var(--accent)" : "var(--line-strong)"}`,
          cursor: calibrating ? "crosshair" : zoom > 1 ? "grab" : "default",
          background: "var(--card-2)", userSelect: "none",
        }}
      >
        {/* zoomable/pannable content */}
        <div style={{ position: "absolute", inset: 0, transformOrigin: "0 0", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          {raster ? (
            <div style={{ position: "absolute", inset: 0, background: `center / cover no-repeat url(${raster})` }} />
          ) : <DrawnIsland />}

          {/* pending calibration marks (counter-scaled to stay a constant size) */}
          {calibrating && pending.map((pt, i) => (
            <div key={i} style={{ position: "absolute", left: `${pt.nx * 100}%`, top: `${pt.ny * 100}%`, transform: `translate(-50%,-50%) scale(${1 / zoom})`, zIndex: 5, pointerEvents: "none" }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--accent)", border: "2px solid #fff", display: "grid", placeItems: "center", color: "#fff", fontSize: 9, fontWeight: 900 }}>{i + 1}</div>
            </div>
          ))}

          {located.map((p) => {
            const { nx, ny } = project(p.location_x, p.location_y);
            const color = dotColor(pkey(p));
            const isHover = hover === pkey(p);
            return (
              <div
                key={pkey(p)}
                onMouseEnter={() => !calibrating && setHover(pkey(p))}
                onMouseLeave={() => setHover((h) => (h === pkey(p) ? null : h))}
                style={{ position: "absolute", left: `${nx * 100}%`, top: `${ny * 100}%`, transform: `translate(-50%, -50%) scale(${1 / zoom})`, zIndex: isHover ? 3 : 2, pointerEvents: calibrating ? "none" : "auto", opacity: calibrating ? 0.55 : 1 }}
              >
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: color, border: "2px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,0.6)", cursor: "default" }} />
                <div style={{
                  position: "absolute", left: "50%", top: -6, transform: "translate(-50%, -100%)",
                  whiteSpace: "nowrap", padding: "2px 6px", borderRadius: 6, pointerEvents: "none",
                  background: "rgba(0,0,0,0.82)", color: "#fff", fontSize: "0.66rem", fontWeight: 800,
                  opacity: isHover ? 1 : 0.9, transition: "opacity 0.1s",
                }}>
                  {p.name}
                  {isHover && (() => { const c = mapCoord(p.location_x, p.location_y); return (
                    <span style={{ fontWeight: 600, opacity: 0.75 }}>{`  (${c.mx}, ${c.my})`}</span>
                  ); })()}
                </div>
              </div>
            );
          })}
        </div>

        {/* empty-state badge (not zoomed) */}
        {located.length === 0 && !calibrating && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 6, pointerEvents: "none" }}>
            <span className="chip" style={{ background: "rgba(0,0,0,0.72)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", fontWeight: 700 }}>
              {!running ? t("map.offline") : list.length ? t("map.noCoords") : t("map.noPlayers")}
            </span>
          </div>
        )}

        {/* zoom controls */}
        <div style={{ position: "absolute", right: 8, bottom: 8, zIndex: 7, display: "flex", flexDirection: "column", gap: 4 }}>
          <button className="btn btn-ghost" style={zoomBtn} onClick={() => zoomBy(1.4)} title="放大" aria-label="放大">+</button>
          <button className="btn btn-ghost" style={zoomBtn} onClick={() => zoomBy(1 / 1.4)} title="缩小" aria-label="缩小">−</button>
          <button className="btn btn-ghost" style={{ ...zoomBtn, fontSize: "0.6rem" }} onClick={resetView} title={t("map.zoomReset")} aria-label={t("map.zoomReset")} disabled={zoom === 1}>1:1</button>
        </div>
      </div>

      {unlocated > 0 && located.length > 0 && (
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.74rem", textAlign: "center", margin: 0 }}>
          {t("map.someNoCoords", { count: unlocated })}
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.7rem", textAlign: "center", margin: 0 }}>{t("map.footer")}</p>
        <span className="subtle" style={{ fontWeight: 700, fontSize: "0.68rem" }}>
          · {hasOverride ? t("map.calStatusCustom", { count: userPts.length }) : t("map.calStatusDefault")}
        </span>
        {hasOverride && !calibrating && (
          <button className="btn btn-ghost" style={{ padding: "0.15rem 0.45rem", fontSize: "0.68rem" }}
            onClick={resetCalibration} title={t("map.calResetHint")}>
            <Icon name="restart" size={11} /> {t("map.calResetBtn")}
          </button>
        )}
      </div>
    </div>
  );
}

// A neutral, self-drawn archipelago used until a real map raster is dropped in at
// public/map/palworld-map.jpg. Deliberately abstract — it's a backdrop, not the
// game's copyrighted map art.
function DrawnIsland() {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
      <defs>
        <radialGradient id="sea" cx="50%" cy="50%" r="75%">
          <stop offset="0%" stopColor="#173a4a" /><stop offset="100%" stopColor="#0e2530" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="url(#sea)" />
      <g fill="#2f5d3a" stroke="#3c7049" strokeWidth="0.5">
        <path d="M40 20 Q58 14 66 28 Q74 40 60 50 Q66 64 50 70 Q34 66 32 52 Q22 44 30 32 Q30 22 40 20 Z" />
        <path d="M20 62 Q28 58 32 66 Q30 74 22 74 Q16 70 20 62 Z" />
        <path d="M70 58 Q80 56 82 64 Q80 72 72 70 Q66 64 70 58 Z" />
        <path d="M52 78 Q62 76 62 82 Q58 88 50 86 Q48 80 52 78 Z" />
      </g>
      <g stroke="rgba(255,255,255,0.06)" strokeWidth="0.4">
        {Array.from({ length: 9 }, (_, i) => <line key={`h${i}`} x1="0" y1={(i + 1) * 10} x2="100" y2={(i + 1) * 10} />)}
        {Array.from({ length: 9 }, (_, i) => <line key={`v${i}`} x1={(i + 1) * 10} y1="0" x2={(i + 1) * 10} y2="100" />)}
      </g>
    </svg>
  );
}
