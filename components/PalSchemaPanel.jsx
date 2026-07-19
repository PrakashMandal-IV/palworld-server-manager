"use client";
import { useEffect, useState, useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";

// PalSchema content-mod management. Sits under the UE4SS section (PalSchema is a UE4SS
// mod): install the framework — downloaded from GitHub or from a user-provided zip —
// then import/enable/disable the JSON content mods that go in its `mods` folder.
export default function PalSchemaPanel({ worldId, world, running }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;
  const windowsTarget = (world?.platform || "windows") === "windows";

  const load = useCallback(async () => {
    try { setData(await api(`/api/worlds/${worldId}/palschema`)); }
    catch (e) { toast(e.message, "error"); }
  }, [worldId]);

  useEffect(() => { load(); }, [load]);

  const installFramework = async (fromZip) => {
    if (running) return toast(t("palschema.stopFirst"), "error");
    let zipPath = null;
    if (fromZip) {
      if (!isElectron) return toast(t("common.pickerDesktop"));
      zipPath = await window.desktop.pickZip();
      if (!zipPath) return;
    }
    setBusy(true);
    if (!fromZip) toast(t("palschema.downloading"));
    try {
      const r = await api(`/api/worlds/${worldId}/palschema`, { method: "POST", body: { zipPath } });
      toast(r.installed ? t("palschema.installedRestart") : t("palschema.installedNotDetected"), r.installed ? "success" : "error");
      setData(r);
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const importMod = async () => {
    if (!isElectron) return toast(t("common.pickerDesktop"));
    const zipPath = await window.desktop.pickZip();
    if (!zipPath) return;
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/palschema/mods`, { method: "POST", body: { action: "import", zipPath } });
      toast(t("palschema.imported", { name: r.result.name }), "success");
      setData((d) => ({ ...d, mods: r.mods }));
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const toggleMod = async (name, enabled) => {
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/palschema/mods`, { method: "POST", body: { action: "toggle", name, enabled } });
      setData((d) => ({ ...d, mods: r.mods }));
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const removeMod = async (name) => {
    if (!confirm(t("palschema.confirmRemove", { name }))) return;
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/palschema/mods`, { method: "POST", body: { action: "remove", name } });
      setData((d) => ({ ...d, mods: r.mods }));
      toast(t("palschema.removed"), "success");
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  if (!data) return <p className="subtle" style={{ fontWeight: 600 }}>{t("palschema.loading")}</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", margin: 0 }}>{t("palschema.title")}</h3>
        {data.installed
          ? <span className="chip" style={{ background: "var(--green-bright)", color: "#0c1a0c" }}>{t("palschema.installed")}</span>
          : <span className="chip" style={{ background: "var(--line-strong)" }}>{t("palschema.notInstalled")}</span>}
      </div>
      <p className="subtle" style={{ fontWeight: 600, fontSize: "0.8rem", marginTop: 0 }}>
        <Trans i18nKey="palschema.desc" components={{ code: <code /> }} />
      </p>

      {!windowsTarget && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--yellow)", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 800, fontSize: "0.86rem", marginBottom: 4 }}>{t("palschema.windowsOnlyTitle")}</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: 0 }}>{t("palschema.windowsOnlyDesc")}</p>
        </div>
      )}

      {!data.ue4ssInstalled && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--red)", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 800, fontSize: "0.86rem", marginBottom: 4 }}>{t("palschema.needUe4ssTitle")}</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: 0 }}>{t("palschema.needUe4ssDesc")}</p>
        </div>
      )}

      {data.ue4ssInstalled && !data.installed && (
        <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", borderLeft: "3px solid var(--yellow)", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>{t("palschema.notInstalledTitle")}</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 6px" }}>
            <Trans i18nKey="palschema.notInstalledDesc" components={{ code: <code /> }} />
          </p>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 10px" }}>
            {t("palschema.mitNote")}{" "}
            <a href="https://github.com/Okaetsu/PalSchema" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 700 }}>GitHub</a>
            {" · "}
            <a href="https://okaetsu.github.io/PalSchema/docs/installation" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 700 }}>{t("palschema.docs")}</a>
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ padding: "0.4rem 0.8rem" }} disabled={busy || running} onClick={() => installFramework(false)}>
              <Icon name="download" size={15} /> {t("palschema.installLatest")}
            </button>
            <button className="btn btn-ghost" style={{ padding: "0.4rem 0.8rem" }} disabled={busy || running} onClick={() => installFramework(true)}>
              <Icon name="upload" size={15} /> {t("palschema.installFromZip")}
            </button>
          </div>
          {running && <span className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", marginLeft: 2, display: "inline-block", marginTop: 6 }}>{t("palschema.stopFirst")}</span>}
        </div>
      )}

      {data.installed && running && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--red)", marginBottom: "1rem" }}>
          <span style={{ fontWeight: 700, fontSize: "0.82rem" }}>{t("palschema.stopToManage")}</span>{" "}
          <span className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem" }}>{t("palschema.loadsAtBoot")}</span>
        </div>
      )}

      {data.installed && (
        <>
          <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={busy || running} onClick={importMod}><Icon name="upload" /> {t("palschema.importMod")}</button>
          </div>

          {data.mods.length === 0 ? (
            <div className="panel-inset" style={{ padding: "1.4rem", textAlign: "center" }}>
              <div className="subtle" style={{ fontWeight: 600 }}><Trans i18nKey="palschema.emptyMods" components={{ code: <code /> }} /></div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {data.mods.map((m) => (
                <div key={m.name} className="panel-inset" style={{ padding: "0.7rem 0.9rem", display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 6, background: "var(--card-2)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Icon name="grid" size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {m.name}
                      {m.hybrid && <span className="chip" style={{ background: "var(--yellow)", color: "#1e1f22" }} title={t("palschema.hybridHelp")}>{t("palschema.hybrid")}</span>}
                    </div>
                  </div>
                  <button className={`btn ${m.enabled ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.35rem 0.7rem" }}
                    disabled={busy || running} onClick={() => toggleMod(m.name, !m.enabled)}>
                    {m.enabled ? t("palschema.enabledBtn") : t("palschema.disabledBtn")}
                  </button>
                  <button className="btn btn-danger" style={{ padding: "0.35rem 0.6rem" }} disabled={busy || running} onClick={() => removeMod(m.name)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.74rem", marginTop: "0.8rem" }}>
            <Trans i18nKey="palschema.restartNote" components={{ b: <b /> }} />
          </p>
        </>
      )}
    </div>
  );
}
