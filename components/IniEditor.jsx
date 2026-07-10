"use client";
import { useEffect, useState, useCallback } from "react";
import { api, Icon, fmtTime, fmtBytes, StatusChip, toast } from "@/components/ui";

// Full-panel in-app editor for PalWorldSettings.ini with version history.
// Every save/restore snapshots the file, so any change can be rolled back.
export default function IniEditor({ world, running }) {
  const worldId = world.world_id;
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [path, setPath] = useState("");
  const [exists, setExists] = useState(false);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null); // { id, content } being viewed

  const loadVersions = useCallback(async () => {
    try { const r = await api(`/api/worlds/${worldId}/ini/versions`); setVersions(r.versions || []); }
    catch { /* history is best-effort */ }
  }, [worldId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api(`/api/worlds/${worldId}/ini`);
      setContent(r.content || "");
      setOriginal(r.content || "");
      setPath(r.path || "");
      setExists(r.exists);
    } catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  }, [worldId]);

  useEffect(() => { load(); loadVersions(); }, [load, loadVersions]);

  const dirty = content !== original;

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/worlds/${worldId}/ini`, { method: "POST", body: { content } });
      setOriginal(content);
      toast(running ? "Saved — restart the world to apply" : "Saved", "success");
      loadVersions();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const viewVersion = async (vid) => {
    try { const r = await api(`/api/worlds/${worldId}/ini/versions/${vid}`); setPreview({ id: vid, content: r.version.content }); }
    catch (e) { toast(e.message, "error"); }
  };

  const restore = async (vid) => {
    if (!confirm("Restore this version? The current file is snapshotted first, so you can undo.")) return;
    try {
      const r = await api(`/api/worlds/${worldId}/ini/versions/${vid}/restore`, { method: "POST" });
      setContent(r.content); setOriginal(r.content); setPreview(null);
      toast(running ? "Restored — restart the world to apply" : "Restored", "success");
      loadVersions();
    } catch (e) { toast(e.message, "error"); }
  };

  return (
    <div>
      {/* Compact world header for this focused editor view */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginBottom: "0.9rem", flexWrap: "wrap" }}>
        <Icon name="settings" size={18} />
        <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>{world.display_name}</div>
        <StatusChip status={world.status} running={running} />
        <div className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem", flex: 1, minWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {path}
        </div>
      </div>

      {running && (
        <div className="panel-inset" style={{ padding: "0.6rem 0.9rem", marginBottom: "0.9rem", borderLeft: "3px solid var(--yellow)", fontSize: "0.78rem", fontWeight: 700 }}>
          The world is running. Palworld rewrites this file on shutdown, so use the app&apos;s <b>Restart</b> to apply edits safely.
        </div>
      )}
      {!exists && !loading && (
        <p className="subtle" style={{ fontWeight: 700, fontSize: "0.8rem", marginTop: 0 }}>
          No saved ini yet — showing the shipped defaults. Saving will create the file.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: "1rem", alignItems: "start" }}>
        {/* Editor */}
        <div>
          <textarea
            className="input"
            spellCheck={false}
            value={loading ? "Loading…" : content}
            onChange={(e) => setContent(e.target.value)}
            disabled={loading}
            style={{ width: "100%", minHeight: 460, fontFamily: "var(--mono, ui-monospace, monospace)", fontSize: "0.8rem", lineHeight: 1.5, whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.7rem" }}>
            <button className="btn btn-ghost" onClick={() => setContent(original)} disabled={!dirty || saving}>
              <Icon name="restart" size={14} /> Revert
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!dirty || saving || loading}>
              <Icon name="download" /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {/* Version history */}
        <div className="panel-inset" style={{ padding: "0.8rem" }}>
          <div className="heading" style={{ fontSize: "0.9rem", marginBottom: "0.6rem" }}>Version history</div>
          {versions.length === 0 ? (
            <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem" }}>No versions yet. Saving creates restore points.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.4rem", maxHeight: 420, overflowY: "auto" }}>
              {versions.map((v) => (
                <div key={v.id} style={{ padding: "0.45rem 0.55rem", border: "1px solid var(--line)", borderRadius: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: "0.74rem" }}>{v.note || "snapshot"}</div>
                  <div className="subtle" style={{ fontSize: "0.68rem", fontWeight: 700 }}>{fmtTime(v.created_at)} · {fmtBytes(v.size)}</div>
                  <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.35rem" }}>
                    <button className="btn btn-ghost" style={{ padding: "0.2rem 0.45rem", fontSize: "0.7rem" }} onClick={() => viewVersion(v.id)}>View</button>
                    <button className="btn btn-amber" style={{ padding: "0.2rem 0.45rem", fontSize: "0.7rem" }} onClick={() => restore(v.id)}>Restore</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {preview && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", zIndex: 50, padding: "2rem" }}>
          <div className="panel" style={{ width: "min(820px, 96vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", padding: "1.1rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.7rem" }}>
              <div className="heading" style={{ fontSize: "1rem" }}>Version #{preview.id}</div>
              <button className="btn btn-ghost" onClick={() => setPreview(null)}><Icon name="x" size={14} /> Close</button>
            </div>
            <textarea className="input" readOnly value={preview.content}
              style={{ flex: 1, minHeight: 360, fontFamily: "var(--mono, ui-monospace, monospace)", fontSize: "0.78rem", whiteSpace: "pre", overflowX: "auto" }} />
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.7rem" }}>
              <button className="btn btn-ghost" onClick={() => { setContent(preview.content); setPreview(null); toast("Loaded into editor — Save to keep", "success"); }}>Load into editor</button>
              <button className="btn btn-amber" onClick={() => restore(preview.id)}>Restore this version</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
