"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui";

// Epic-style downloads tray: a persistent pill in the bottom-left that shows
// minimal progress for all install/update jobs, expandable to a panel with
// per-job progress bars and full logs. Mounted once in Shell, polls /api/jobs.
export default function DownloadTray() {
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => new Set());
  const timer = useRef(null);

  const poll = async () => {
    try {
      const r = await fetch("/api/jobs", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) setJobs(d.jobs || []);
    } catch {}
  };

  useEffect(() => {
    // Adaptive cadence: fast while something is running, relaxed when idle.
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      await poll();
      const active = jobsRef.current.some((j) => j.status === "running");
      timer.current = setTimeout(loop, active ? 1000 : 3500);
    };
    loop();
    // Let pages force an immediate refresh right after starting a job.
    window.__palJobsPing = () => poll();
    return () => { stopped = true; clearTimeout(timer.current); try { delete window.__palJobsPing; } catch {} };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const visible = jobs.filter((j) => !dismissed.has(j.id));
  const running = visible.filter((j) => j.status === "running");
  const dismiss = (id) => setDismissed((s) => new Set(s).add(id));
  const clearFinished = () => {
    const next = new Set(dismissed);
    visible.forEach((j) => { if (j.status !== "running") next.add(j.id); });
    setDismissed(next);
  };

  if (visible.length === 0) return null;

  // Collapsed pill summary
  const summary = running.length
    ? (running.length === 1
        ? `${labelFor(running[0])} · ${running[0].message}`
        : `${running.length} downloads in progress`)
    : (visible.some((j) => j.status === "error") ? "Download failed" : "Downloads complete");
  const aggPct = running.length === 1 ? running[0].percent : null;

  return (
    <div style={{ position: "fixed", left: 18, bottom: 18, width: open ? 380 : 300, maxWidth: "90vw", zIndex: 45 }}>
      {open && (
        <div className="panel animate-floatUp" style={{ marginBottom: 8, maxHeight: "60vh", overflow: "auto", padding: "0.6rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.2rem 0.4rem 0.5rem" }}>
            <span className="heading" style={{ fontSize: "0.92rem" }}>Downloads &amp; updates</span>
            {visible.some((j) => j.status !== "running") && (
              <button onClick={clearFinished} className="subtle"
                style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700 }}>
                Clear finished
              </button>
            )}
          </div>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {visible.map((j) => <JobCard key={j.id} job={j} onDismiss={() => dismiss(j.id)} />)}
          </div>
        </div>
      )}

      {/* Collapsed pill */}
      <button onClick={() => setOpen((o) => !o)}
        className="panel"
        style={{ width: "100%", padding: "0.6rem 0.75rem", cursor: "pointer", textAlign: "left", border: "1px solid var(--line-strong)", display: "block" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <StatusIcon jobs={visible} running={running} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "0.8rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</div>
          </div>
          <Icon name={open ? "chevronDown" : "chevronUp"} size={16} />
        </div>
        {running.length > 0 && <ProgressBar percent={aggPct} style={{ marginTop: "0.5rem" }} />}
      </button>
    </div>
  );
}

function StatusIcon({ jobs, running }) {
  if (running.length) {
    return (
      <span className="animate-pulseDot" style={{ color: "var(--accent)", display: "grid", placeItems: "center" }}>
        <Icon name="download" size={18} />
      </span>
    );
  }
  const failed = jobs.some((j) => j.status === "error");
  return (
    <span style={{ color: failed ? "var(--red)" : "var(--green-bright)", display: "grid", placeItems: "center" }}>
      <Icon name={failed ? "alert" : "check"} size={18} />
    </span>
  );
}

function JobCard({ job, onDismiss }) {
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef(null);
  useEffect(() => { if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [job.lines, showLog]);

  const color = job.status === "error" ? "var(--red)" : job.status === "success" ? "var(--green-bright)" : "var(--accent)";
  const verb = job.type === "install" ? "Installing" : "Updating";
  const statusLabel = job.status === "running" ? job.message
    : job.status === "success" ? "Done" : (job.error || "Failed");

  return (
    <div className="panel-inset" style={{ padding: "0.6rem 0.7rem", borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: job.status === "running" ? 6 : 2 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "0.82rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {labelFor(job)}
          </div>
          <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 600 }}>
            {job.status === "running" ? verb : ""} {statusLabel}
          </div>
        </div>
        {job.percent != null && job.status === "running" && (
          <span style={{ fontSize: "0.78rem", fontWeight: 800, color }}>{job.percent}%</span>
        )}
        {job.status !== "running" && (
          <button onClick={onDismiss} title="Dismiss"
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-soft)", padding: 2, display: "grid", placeItems: "center" }}>
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
      {job.status === "running" && <ProgressBar percent={job.percent} />}
      <div style={{ marginTop: 6 }}>
        <button onClick={() => setShowLog((s) => !s)} className="subtle"
          style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "0.7rem", fontWeight: 700, padding: 0 }}>
          {showLog ? "Hide details" : "Show details"}
        </button>
      </div>
      {showLog && (
        <div ref={logRef} className="console" style={{ height: 150, marginTop: 6 }}>
          {(job.lines || []).length === 0
            ? <div className="ln subtle">Waiting for output…</div>
            : job.lines.map((l, i) => <div key={i} className="ln">{l}</div>)}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ percent, style }) {
  const indeterminate = percent == null;
  return (
    <div style={{ position: "relative", height: 6, borderRadius: 999, background: "var(--line)", overflow: "hidden", ...style }}
      className={indeterminate ? "bar-indet" : undefined}>
      {!indeterminate && (
        <div style={{ position: "absolute", inset: 0, width: `${percent}%`, background: "var(--accent)", borderRadius: 999, transition: "width 0.3s ease" }} />
      )}
    </div>
  );
}

function labelFor(job) {
  return job.worldName || (job.type === "install" ? "New server" : "Server update");
}
