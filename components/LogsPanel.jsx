"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui";

export default function LogsPanel({ worldId }) {
  const { t } = useTranslation();
  const [lines, setLines] = useState([]);
  const [live, setLive] = useState(true);
  const boxRef = useRef(null);
  const esRef = useRef(null);

  useEffect(() => {
    if (!live) { esRef.current?.close(); return; }
    const es = new EventSource(`/api/worlds/${worldId}/logs/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const line = JSON.parse(ev.data);
        setLines((prev) => {
          const next = [...prev, line];
          return next.length > 800 ? next.slice(-800) : next;
        });
      } catch {}
    };
    es.onerror = () => { /* keep the panel; browser auto-reconnects */ };
    return () => es.close();
  }, [worldId, live]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
        <div className="subtle" style={{ fontWeight: 800, fontSize: "0.72rem" }}>{t("logs.linesBuffered", { count: lines.length })}</div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem" }} onClick={() => setLines([])}>{t("logs.clear")}</button>
          <button className={`btn ${live ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.3rem 0.7rem" }} onClick={() => setLive((v) => !v)}>
            {live ? t("logs.live") : t("logs.paused")}
          </button>
        </div>
      </div>
      <div ref={boxRef} className="console" style={{ height: 420 }}>
        {lines.length === 0
          ? <div className="ln subtle">{t("logs.waiting")}</div>
          : lines.map((l, i) => <div key={i} className="ln">{l}</div>)}
      </div>
    </div>
  );
}
