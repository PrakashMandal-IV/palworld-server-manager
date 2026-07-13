"use client";
// app/usage/page.jsx
// Analytical CPU / RAM monitoring for running worlds — aggregate across all
// running worlds or drill into a single world via the selector. Charts are
// dependency-free inline SVG so they theme with the rest of the app.
//
// Author: Prakash Mandal <prakashmandal.iv@gmail.com>
import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Icon, fmtBytes } from "@/components/ui";

// Distinct, colour-blind-friendly series palette (stable per world index).
const PALETTE = ["#6c8cff", "#ffb454", "#4ec9a3", "#e06c9f", "#c792ea", "#f07178", "#7fdbca", "#ffd479"];

export default function UsagePage() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState("all");   // "all" | world_id
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/metrics", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) { setData(d); setErr(null); }
      else setErr(d.error || t("usage.metricsError"));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const items = data?.items || [];
  const colorFor = useMemo(() => {
    const m = new Map();
    items.forEach((it, i) => m.set(it.world_id, it.accent || PALETTE[i % PALETTE.length]));
    return m;
  }, [items]);

  // Keep the selection valid as worlds start/stop.
  useEffect(() => {
    if (selected !== "all" && !items.some((i) => i.world_id === selected)) setSelected("all");
  }, [items, selected]);

  const single = selected !== "all" ? items.find((i) => i.world_id === selected) : null;

  return (
    <div>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "1.2rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 className="heading" style={{ fontSize: "1.9rem", margin: 0 }}>{t("usage.title")}</h1>
          <p className="subtle" style={{ margin: "0.2rem 0 0", fontWeight: 700 }}>
            {t("usage.subtitle", { cores: data?.ncpu ?? "—", sec: Math.round((data?.sampleMs || 4000) / 1000) })}
          </p>
        </div>
        {items.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="subtle" style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("common.scope")}</span>
            <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}
              style={{ padding: "0.45rem 0.6rem", minWidth: 200, fontWeight: 700 }}>
              <option value="all">{t("usage.allRunning")}</option>
              {items.map((i) => <option key={i.world_id} value={i.world_id}>{i.name}</option>)}
            </select>
          </div>
        )}
      </header>

      {loading ? (
        <div className="panel" style={{ padding: "2rem", textAlign: "center" }}><span className="subtle">{t("common.loading")}</span></div>
      ) : err ? (
        <div className="panel" style={{ padding: "1.4rem", borderLeft: "3px solid var(--red)" }}><span style={{ fontWeight: 700 }}>{err}</span></div>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : single ? (
        <SingleView item={single} totalMemMB={data.totalMemMB} ncpu={data.ncpu} color={colorFor.get(single.world_id)} />
      ) : (
        <AllView data={data} colorFor={colorFor} />
      )}
    </div>
  );
}

/* ------------------------------- Views ---------------------------------- */

function AllView({ data, colorFor }) {
  const { t } = useTranslation();
  const { items, total, totalMemMB } = data;
  const cpuSeries = items.map((i) => ({ name: i.name, color: colorFor.get(i.world_id), points: i.history.map((h) => ({ t: h.t, v: h.cpu })) }));
  const ramSeries = items.map((i) => ({ name: i.name, color: colorFor.get(i.world_id), points: i.history.map((h) => ({ t: h.t, v: h.rssMB })) }));

  return (
    <div style={{ display: "grid", gap: "1.1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.8rem" }}>
        <StatTile label={t("usage.totalCpu")} value={`${total.cpu}%`} sub={t("usage.ofCores", { n: data.ncpu })} accent="var(--accent)" />
        <StatTile label={t("usage.totalMemory")} value={fmtBytes(total.rssMB * 1024 * 1024)} sub={t("usage.ofMemory", { total: fmtBytes(totalMemMB * 1024 * 1024) })} accent="var(--green-bright)" />
        <StatTile label={t("usage.worldsRunning")} value={total.worlds} sub={t("usage.liveProcesses")} accent="var(--yellow)" />
      </div>

      <Card title={t("usage.cpuOverTime")} hint={t("usage.pctOfMachine")}>
        <LineChart series={cpuSeries} unit="%" fixedMax={niceMax(Math.max(5, ...cpuSeries.flatMap((s) => s.points.map((p) => p.v)), 0))} />
        <Legend series={cpuSeries} />
      </Card>

      <Card title={t("usage.memOverTime")} hint={t("usage.workingSet")}>
        <LineChart series={ramSeries} unit="MB" format={(v) => fmtBytes(v * 1024 * 1024)} />
        <Legend series={ramSeries} />
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.1rem" }}>
        <Card title={t("usage.cpuByWorld")} hint={t("common.current")}>
          <BarChart items={items.map((i) => ({ name: i.name, value: i.cpu, color: colorFor.get(i.world_id), label: `${i.cpu}%` }))} max={niceMax(Math.max(5, ...items.map((i) => i.cpu)))} />
        </Card>
        <Card title={t("usage.memByWorld")} hint={t("common.current")}>
          <BarChart items={items.map((i) => ({ name: i.name, value: i.rssMB, color: colorFor.get(i.world_id), label: fmtBytes(i.rssMB * 1024 * 1024) }))} max={niceMax(Math.max(64, ...items.map((i) => i.rssMB)))} />
        </Card>
      </div>
    </div>
  );
}

function SingleView({ item, totalMemMB, ncpu, color }) {
  const { t } = useTranslation();
  const cpuSeries = [{ name: item.name, color, points: item.history.map((h) => ({ t: h.t, v: h.cpu })) }];
  const ramSeries = [{ name: item.name, color, points: item.history.map((h) => ({ t: h.t, v: h.rssMB })) }];
  const peakCpu = Math.max(0, ...item.history.map((h) => h.cpu));
  const peakRam = Math.max(0, ...item.history.map((h) => h.rssMB));

  return (
    <div style={{ display: "grid", gap: "1.1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.8rem" }}>
        <StatTile label={t("usage.cpuNow")} value={`${item.cpu}%`} sub={t("usage.peakCpu", { peak: Math.round(peakCpu * 10) / 10, cores: ncpu })} accent="var(--accent)" />
        <StatTile label={t("usage.memNow")} value={fmtBytes(item.rssMB * 1024 * 1024)} sub={t("usage.peakMem", { peak: fmtBytes(peakRam * 1024 * 1024) })} accent="var(--green-bright)" />
        <StatTile label={t("usage.processes")} value={item.pids} sub={t("usage.inServerTree")} accent="var(--yellow)" />
      </div>

      <Card title={t("usage.cpuOverTime")} hint={t("usage.pctOfMachine")}>
        <LineChart series={cpuSeries} unit="%" area fixedMax={niceMax(Math.max(5, peakCpu))} />
      </Card>

      <Card title={t("usage.memOverTime")} hint={t("usage.workingSet")}>
        <LineChart series={ramSeries} unit="MB" area format={(v) => fmtBytes(v * 1024 * 1024)} />
      </Card>
    </div>
  );
}

/* ------------------------------- Charts --------------------------------- */

// Shared SVG line chart. `series`: [{ name, color, points:[{t,v}] }].
function LineChart({ series, unit = "", area = false, fixedMax = null, format }) {
  const { t } = useTranslation();
  const W = 720, H = 220, padL = 46, padR = 12, padT = 12, padB = 22;
  const all = series.flatMap((s) => s.points);
  const hasData = all.length > 0;

  const tMin = hasData ? Math.min(...all.map((p) => p.t)) : 0;
  const tMax = hasData ? Math.max(...all.map((p) => p.t)) : 1;
  const vMaxRaw = fixedMax != null ? fixedMax : niceMax(Math.max(1, ...all.map((p) => p.v)));
  const vMax = vMaxRaw || 1;
  const tSpan = tMax - tMin || 1;

  const x = (t) => padL + ((t - tMin) / tSpan) * (W - padL - padR);
  const y = (v) => padT + (1 - v / vMax) * (H - padT - padB);

  const fmt = format || ((v) => `${v}${unit}`);
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * vMax));

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", minWidth: 320 }} preserveAspectRatio="none">
        {/* horizontal grid + y labels */}
        {gridVals.map((gv, i) => {
          const gy = y(gv);
          return (
            <g key={i}>
              <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--line)" strokeWidth="1" />
              <text x={padL - 6} y={gy + 3} textAnchor="end" fontSize="10" fill="var(--ink-soft)" fontWeight="600">
                {typeof gridVals[i] === "number" ? fmt(gv) : gv}
              </text>
            </g>
          );
        })}

        {!hasData && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="12" fill="var(--ink-soft)" fontWeight="700">{t("usage.collecting")}</text>
        )}

        {series.map((s, si) => {
          if (s.points.length === 0) return null;
          const line = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
          const areaD = area
            ? `${line} L ${x(s.points[s.points.length - 1].t).toFixed(1)} ${y(0).toFixed(1)} L ${x(s.points[0].t).toFixed(1)} ${y(0).toFixed(1)} Z`
            : null;
          return (
            <g key={si}>
              {area && <path d={areaD} fill={s.color} opacity="0.14" />}
              <path d={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {s.points.length === 1 && <circle cx={x(s.points[0].t)} cy={y(s.points[0].v)} r="3" fill={s.color} />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Horizontal bar chart for current per-world comparison.
function BarChart({ items, max }) {
  const m = max || Math.max(1, ...items.map((i) => i.value));
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(70px, 26%) 1fr auto", alignItems: "center", gap: "0.6rem" }}>
          <span style={{ fontWeight: 700, fontSize: "0.8rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={it.name}>{it.name}</span>
          <div style={{ height: 16, borderRadius: 6, background: "var(--line)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, (it.value / m) * 100)}%`, background: it.color, borderRadius: 6, transition: "width 0.4s ease", minWidth: it.value > 0 ? 2 : 0 }} />
          </div>
          <span className="subtle" style={{ fontWeight: 800, fontSize: "0.78rem", minWidth: 62, textAlign: "right" }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- Bits ----------------------------------- */

function Card({ title, hint, children }) {
  return (
    <div className="panel" style={{ padding: "1rem 1.1rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "0.8rem" }}>
        <h3 className="heading" style={{ fontSize: "1rem", margin: 0 }}>{title}</h3>
        {hint && <span className="subtle" style={{ fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function StatTile({ label, value, sub, accent }) {
  return (
    <div className="panel" style={{ padding: "0.9rem 1rem", borderLeft: `3px solid ${accent}` }}>
      <div className="subtle" style={{ fontSize: "0.66rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div className="heading" style={{ fontSize: "1.5rem", margin: "0.15rem 0" }}>{value}</div>
      <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 600 }}>{sub}</div>
    </div>
  );
}

function Legend({ series }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem", marginTop: "0.7rem" }}>
      {series.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: s.color, flexShrink: 0 }} />
          <span className="subtle" style={{ fontSize: "0.76rem", fontWeight: 700 }}>{s.name}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="panel" style={{ padding: "3rem 2rem", textAlign: "center" }}>
      <div style={{ width: 66, height: 66, borderRadius: 8, background: "var(--card-2)", display: "grid", placeItems: "center", margin: "0 auto 1rem", color: "var(--ink-soft)" }}>
        <Icon name="activity" size={34} />
      </div>
      <h2 className="heading" style={{ fontSize: "1.4rem", margin: "0 0 0.4rem" }}>{t("usage.emptyTitle")}</h2>
      <p className="subtle" style={{ fontWeight: 700, maxWidth: 460, margin: "0 auto" }}>
        {t("usage.emptyBody")}
      </p>
    </div>
  );
}

/* ------------------------------- utils ---------------------------------- */

// Round a max value up to a clean axis bound (e.g. 5 → 5, 37 → 40, 220 → 250).
function niceMax(v) {
  if (!isFinite(v) || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return Math.ceil(v / (step * pow / 10)) * (step * pow / 10);
}
