"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useJobsPoll, JobCard } from "@/components/jobsClient";

export default function DownloadsPage() {
  const { t } = useTranslation();
  const jobs = useJobsPoll();
  const [dismissed, setDismissed] = useState(() => new Set());

  const visible = jobs.filter((j) => !dismissed.has(j.id));
  const active = visible.filter((j) => j.status === "running");
  const history = visible.filter((j) => j.status !== "running");

  const dismiss = (id) => setDismissed((s) => new Set(s).add(id));
  const clearHistory = () => setDismissed((s) => {
    const n = new Set(s);
    history.forEach((j) => n.add(j.id));
    return n;
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.2rem" }}>
        <h1 className="heading" style={{ fontSize: "1.6rem", margin: 0 }}>{t("downloads.title")}</h1>
        {history.length > 0 && (
          <button className="btn btn-ghost" onClick={clearHistory}>{t("downloads.clearHistory")}</button>
        )}
      </div>

      <Section title={`${t("downloads.inProgress")}${active.length ? ` (${active.length})` : ""}`}>
        {active.length === 0
          ? <Empty text={t("downloads.noActive")} />
          : <div style={{ display: "grid", gap: "0.7rem" }}>{active.map((j) => <JobCard key={j.id} job={j} />)}</div>}
      </Section>

      <Section title={t("downloads.history")}>
        {history.length === 0
          ? <Empty text={t("downloads.historyEmpty")} />
          : <div style={{ display: "grid", gap: "0.7rem" }}>{history.map((j) => <JobCard key={j.id} job={j} onDismiss={() => dismiss(j.id)} />)}</div>}
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: "1.8rem" }}>
      <div className="subtle" style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.7rem" }}>{title}</div>
      {children}
    </div>
  );
}

function Empty({ text }) {
  return <div className="panel-inset" style={{ padding: "1.1rem", textAlign: "center" }} ><span className="subtle" style={{ fontWeight: 600, fontSize: "0.86rem" }}>{text}</span></div>;
}
