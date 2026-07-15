"use client";
import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";
import MapPanel from "@/components/MapPanel";

// Developer-only tool: connect to a Palworld REST API, pull the live player list,
// then place reference points on the map to solve (and bake) the calibration.
export default function MapCalibrationPage() {
  const { t } = useTranslation();
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("8212");
  const [password, setPassword] = useState("");
  const [players, setPlayers] = useState(null); // null = not connected
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const r = await api("/api/map/probe", { method: "POST", body: { host: host.trim(), port: Number(port), password } });
      setPlayers(r.players || []);
      toast(t("mapCal.connected", { count: (r.players || []).length }), "success");
    } catch (e) { toast(e.message, "error"); setPlayers(null); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <Link href="/settings" className="btn btn-ghost" style={{ marginBottom: "1rem" }}>
        <Icon name="back" /> {t("mapCal.backToSettings")}
      </Link>

      <h1 className="heading" style={{ fontSize: "1.5rem", marginTop: 0 }}>{t("mapCal.title")}</h1>
      <p className="subtle" style={{ fontWeight: 600, fontSize: "0.84rem" }}>{t("mapCal.intro")}</p>

      <div className="panel-inset" style={{ padding: "1rem 1.1rem", margin: "1rem 0", display: "grid", gap: "0.7rem" }}>
        <div style={{ fontWeight: 800, fontSize: "0.92rem" }}>{t("mapCal.connectTitle")}</div>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="label">{t("mapCal.host")}</label>
            <input className="input" value={host} onChange={(e) => setHost(e.target.value)} style={{ width: 160 }} />
          </div>
          <div>
            <label className="label">{t("mapCal.port")}</label>
            <input className="input" value={port} onChange={(e) => setPort(e.target.value)} style={{ width: 100 }} inputMode="numeric" />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label className="label">{t("mapCal.password")}</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("mapCal.passwordPlaceholder")} />
          </div>
          <button className="btn btn-primary" onClick={connect} disabled={busy || !host.trim() || !port}>
            <Icon name="globe" size={15} /> {busy ? t("mapCal.connecting") : t("mapCal.connect")}
          </button>
        </div>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", margin: 0 }}>{t("mapCal.restHint")}</p>
      </div>

      {players !== null && (
        players.length === 0 ? (
          <p style={{ color: "var(--yellow)", fontWeight: 700 }}>{t("mapCal.noPlayers")}</p>
        ) : (
          <>
            <p className="subtle" style={{ fontWeight: 700, fontSize: "0.82rem" }}>{t("mapCal.howto")}</p>
            <MapPanel players={{ players }} running={true} devCalibrate />
          </>
        )
      )}
    </div>
  );
}
