"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui";

// Shared client helpers for the downloads/updates system: a polling hook used by
// both the sidebar indicator and the Downloads page, plus the job card UI.

const PHASE_LABELS = {
  starting: "Starting", steamcmd: "Updating SteamCMD", prepare: "Preparing",
  download: "Downloading server files", verify: "Verifying files", install: "Installing",
  backup: "Backing up", settings: "Writing settings", finalizing: "Finishing up",
};
export function phaseLabel(phase) { return PHASE_LABELS[phase] || "Working"; }
export function labelFor(job) { return job.worldName || (job.type === "install" ? "New server" : "Server update"); }

// Poll /api/jobs, fast while something runs, relaxed when idle. Exposes
// window.__palJobsPing() so a page can force an immediate refresh after starting.
export function useJobsPoll() {
  const [jobs, setJobs] = useState([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  useEffect(() => {
    let stopped = false, t;
    const poll = async () => {
      try {
        const r = await fetch("/api/jobs", { cache: "no-store" });
        const d = await r.json();
        if (d.ok && !stopped) setJobs(d.jobs || []);
      } catch {}
    };
    const loop = async () => {
      if (stopped) return;
      await poll();
      const active = jobsRef.current.some((j) => j.status === "running");
      t = setTimeout(loop, active ? 1000 : 3500);
    };
    loop();
    window.__palJobsPing = () => poll();
    return () => { stopped = true; clearTimeout(t); try { delete window.__palJobsPing; } catch {} };
  }, []);
  return jobs;
}

export function ProgressBar({ percent, style }) {
  const indeterminate = percent == null;
  return (
    <div style={{ position: "relative", height: 7, borderRadius: 999, background: "var(--line)", overflow: "hidden", ...style }}
      className={indeterminate ? "bar-indet" : undefined}>
      {!indeterminate && (
        <div style={{ position: "absolute", inset: 0, width: `${percent}%`, background: "var(--accent)", borderRadius: 999, transition: "width 0.3s ease" }} />
      )}
    </div>
  );
}

export function JobCard({ job, onDismiss }) {
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef(null);
  useEffect(() => { if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [job.lines, showLog]);

  const color = job.status === "error" ? "var(--red)" : job.status === "success" ? "var(--green-bright)" : "var(--accent)";
  const running = job.status === "running";
  const typeLabel = job.type === "install" ? "Install" : "Update";

  return (
    <div className="panel-inset" style={{ padding: "0.9rem 1rem", borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
        <span style={{ color, display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Icon name={job.status === "error" ? "alert" : job.status === "success" ? "check" : "download"} size={20} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
            <span style={{ fontWeight: 700, fontSize: "0.92rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{labelFor(job)}</span>
            <span className="subtle" style={{ fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>{typeLabel}</span>
          </div>
          <div className="subtle" style={{ fontSize: "0.78rem", fontWeight: 600 }}>
            {running ? (job.message || phaseLabel(job.phase)) : (job.status === "success" ? "Completed" : (job.error || "Failed"))}
          </div>
        </div>
        {running && job.percent != null && <span style={{ fontSize: "0.9rem", fontWeight: 800, color }}>{job.percent}%</span>}
        {!running && onDismiss && (
          <button onClick={onDismiss} title="Dismiss" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-soft)", padding: 3, display: "grid", placeItems: "center" }}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {running && <ProgressBar percent={job.percent} style={{ marginTop: "0.7rem" }} />}
      <div style={{ marginTop: 8, display: "flex", gap: "0.8rem", alignItems: "center" }}>
        <button onClick={() => setShowLog((s) => !s)} className="subtle" style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700, padding: 0 }}>
          {showLog ? "Hide log" : "Show log"}
        </button>
        {job.startedAt && <span className="subtle" style={{ fontSize: "0.7rem", fontWeight: 600 }}>{new Date(job.startedAt).toLocaleTimeString()}</span>}
      </div>
      {showLog && (
        <div ref={logRef} className="console" style={{ height: 200, marginTop: 8 }}>
          {(job.lines || []).length === 0
            ? <div className="ln subtle">Waiting for output…</div>
            : job.lines.map((l, i) => <div key={i} className="ln">{l}</div>)}
        </div>
      )}
    </div>
  );
}

// Aggregate summary for the sidebar indicator.
export function summarize(jobs) {
  const running = jobs.filter((j) => j.status === "running");
  const activeCount = running.length;
  const percent = activeCount === 1 ? running[0].percent : null;
  const anyError = jobs.some((j) => j.status === "error");
  return { activeCount, percent, anyError, running };
}
