"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, Icon, fmtBytes, fmtTime, toast } from "@/components/ui";

export default function BackupsPanel({ worldId, backups, running, onChange }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loc, setLoc] = useState(null);
  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;

  useEffect(() => {
    api(`/api/settings/backup-dir?worldId=${encodeURIComponent(worldId)}`).then((r) => setLoc(r.backup)).catch(() => {});
  }, [worldId]);

  const openFolder = () => { if (isElectron && loc?.worldPath) window.desktop.openPath(loc.worldPath); };

  const create = async () => {
    setBusy(true);
    try {
      await api(`/api/worlds/${worldId}/backups`, { method: "POST" });
      toast(t("backups.created"), "success");
      onChange();
    } catch (e) { toast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const restore = async (backupId) => {
    if (running) return toast(t("backups.stopBeforeRestore"), "error");
    if (!confirm(t("backups.confirmRestore"))) return;
    setBusy(true);
    try {
      await api(`/api/worlds/${worldId}/backups/restore`, { method: "POST", body: { backupId } });
      toast(t("backups.restored"), "success");
      onChange();
    } catch (e) { toast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const importSave = async () => {
    if (running) return toast(t("backups.stopBeforeImport"), "error");
    if (!isElectron) return toast(t("backups.importPickerDesktop"));
    const zipPath = await window.desktop.pickZip();
    if (!zipPath) return;
    setImporting(true);
    try {
      const { check } = await api(`/api/worlds/${worldId}/import`, { method: "POST", body: { zipPath } });
      toast(t("backups.imported", { count: check.playerCount }), "success");
      onChange();
    } catch (e) { toast(e.message, "error"); }
    finally { setImporting(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={create} disabled={busy}>
          <Icon name="download" /> {busy ? t("backups.working") : t("backups.backupNow")}
        </button>
        <button className="btn btn-ghost" onClick={importSave} disabled={importing || running}>
          <Icon name="upload" /> {importing ? t("backups.importing") : t("backups.importSave")}
        </button>
        {isElectron && loc?.worldPath && (
          <button className="btn btn-ghost" onClick={openFolder} title={loc.worldPath}>
            <Icon name="folder" /> {t("backups.openFolder")}
          </button>
        )}
      </div>

      {loc && (
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem", margin: "-0.4rem 0 1rem", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
          {loc.worldPath}
        </p>
      )}

      {backups.length === 0 ? (
        <p className="subtle" style={{ fontWeight: 700 }}>{t("backups.empty")}</p>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {backups.map((b) => (
            <div key={b.id} className="panel-inset" style={{ padding: "0.6rem 0.8rem", display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
              <Icon name="download" size={16} />
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontWeight: 800, fontSize: "0.84rem" }}>{fmtTime(b.created_at)}</div>
                <div className="subtle" style={{ fontSize: "0.72rem", fontWeight: 700 }}>{fmtBytes(b.size_bytes)} · {b.reason}</div>
              </div>
              <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem" }} disabled={busy || running} onClick={() => restore(b.id)}>
                <Icon name="restart" size={14} /> {t("common.restore")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
