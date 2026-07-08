"use client";
import { useEffect, useState, useCallback } from "react";
import { api, Icon, toast } from "@/components/ui";

export default function Ue4ssPanel({ worldId, running }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;

  const load = useCallback(async () => {
    try { setData(await api(`/api/worlds/${worldId}/ue4ss`)); }
    catch (e) { toast(e.message, "error"); }
  }, [worldId]);

  useEffect(() => { load(); }, [load]);

  const installUe4ss = async () => {
    if (!isElectron) return toast("File picker is available in the desktop app.");
    if (running) return toast("Stop the world before installing UE4SS.", "error");
    const zipPath = await window.desktop.pickZip();
    if (!zipPath) return;
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/ue4ss`, { method: "POST", body: { zipPath } });
      toast(r.installed ? "UE4SS installed — restart the world to load it." : "Install ran but UE4SS was not detected.", r.installed ? "success" : "error");
      load();
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const fixGui = async () => {
    setBusy(true);
    try { setData(await api(`/api/worlds/${worldId}/ue4ss`, { method: "PATCH" })); toast("Disabled UE4SS console (restart to apply)", "success"); }
    catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const importMod = async () => {
    if (!isElectron) return toast("File picker is available in the desktop app.");
    const zipPath = await window.desktop.pickZip();
    if (!zipPath) return;
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/ue4ss/mods`, { method: "POST", body: { action: "import", zipPath } });
      toast(`Imported ${r.result.name}`, "success");
      setData((d) => ({ ...d, mods: r.mods }));
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const toggleMod = async (name, enabled) => {
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/ue4ss/mods`, { method: "POST", body: { action: "toggle", name, enabled } });
      setData((d) => ({ ...d, mods: r.mods }));
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const removeMod = async (name) => {
    if (!confirm(`Remove UE4SS mod "${name}"? Its files will be deleted.`)) return;
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${worldId}/ue4ss/mods`, { method: "POST", body: { action: "remove", name } });
      setData((d) => ({ ...d, mods: r.mods }));
      toast("Mod removed", "success");
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  if (!data) return <p className="subtle" style={{ fontWeight: 600 }}>Loading UE4SS…</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
        <h3 className="heading" style={{ fontSize: "1.05rem", margin: 0 }}>UE4SS / Lua mods</h3>
        {data.installed
          ? <span className="chip" style={{ background: "var(--green-bright)", color: "#0c1a0c" }}>Installed</span>
          : <span className="chip" style={{ background: "var(--line-strong)" }}>Not installed</span>}
      </div>
      <p className="subtle" style={{ fontWeight: 600, fontSize: "0.8rem", marginTop: 0 }}>
        UE4SS runs Lua script mods (most Palworld mods on Nexus). This is separate from the
        Steam Workshop system above. Mods install under your server&apos;s UE4SS mods folder
        (<code>Pal\Binaries\Win64\ue4ss\Mods</code> on UE4SS 3.0).
      </p>

      {!data.installed && (
        <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", borderLeft: "3px solid var(--yellow)", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>UE4SS isn’t installed for this world</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>
            Download the UE4SS release zip (the dedicated-server build) from its official page, then install it here.
            The app extracts it into <code>Win64</code> and sets the dedicated-server-safe options for you.
          </p>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 10px" }}>
            Get UE4SS:{" "}
            <a href="https://pwmodding.wiki/docs/users/ue4ss/installation-server" target="_blank" rel="noreferrer"
              style={{ color: "var(--accent)", fontWeight: 700 }}>Palworld UE4SS install guide</a>
            {" · "}
            <a href="https://github.com/UE4SS-RE/RE-UE4SS/releases" target="_blank" rel="noreferrer"
              style={{ color: "var(--accent)", fontWeight: 700 }}>UE4SS releases</a>
          </p>
          <button className="btn btn-primary" style={{ padding: "0.4rem 0.8rem" }} disabled={busy || running} onClick={installUe4ss}>
            <Icon name="upload" size={15} /> Install UE4SS (.zip)
          </button>
          {running && <span className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", marginLeft: 8 }}>Stop the world first.</span>}
        </div>
      )}

      {data.installed && data.guiConsoleVisible === true && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--red)", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 800, fontSize: "0.86rem", marginBottom: 4 }}>⚠ UE4SS console is enabled</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>
            <code>GuiConsoleVisible</code> is on, which crashes a dedicated server on launch. Turn it off.
          </p>
          <button className="btn btn-primary" style={{ padding: "0.35rem 0.7rem" }} disabled={busy} onClick={fixGui}>Disable console</button>
        </div>
      )}

      {data.installed && (
        <>
          <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={busy} onClick={importMod}><Icon name="upload" /> Import Lua mod (.zip)</button>
          </div>

          {data.mods.length === 0 ? (
            <div className="panel-inset" style={{ padding: "1.4rem", textAlign: "center" }}>
              <div className="subtle" style={{ fontWeight: 600 }}>No UE4SS mods yet. Import a Lua mod (.zip containing <code>Scripts/main.lua</code>).</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {data.mods.map((m) => (
                <div key={m.name} className="panel-inset" style={{ padding: "0.7rem 0.9rem", display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 6, background: "var(--card-2)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Icon name="terminal" size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8 }}>
                      {m.name}
                      {!m.hasLua && <span className="chip" style={{ background: "var(--yellow)", color: "#1e1f22" }}>No main.lua</span>}
                      {m.forcedByEnabledTxt && <span className="chip" style={{ background: "var(--card-2)" }}>enabled.txt</span>}
                    </div>
                  </div>
                  <button className={`btn ${m.enabled ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.35rem 0.7rem" }}
                    disabled={busy} onClick={() => toggleMod(m.name, !m.enabled)}>
                    {m.enabled ? "Enabled" : "Disabled"}
                  </button>
                  <button className="btn btn-danger" style={{ padding: "0.35rem 0.6rem" }} disabled={busy} onClick={() => removeMod(m.name)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.74rem", marginTop: "0.8rem" }}>
            Mods load at server boot — <b>restart the world</b> after any change.
          </p>
        </>
      )}
    </div>
  );
}
