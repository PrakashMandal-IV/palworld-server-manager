"use client";
import { useEffect, useState } from "react";
import { api, Icon, toast } from "@/components/ui";

export default function CreateWorldModal({ onClose, onDone }) {
  const [mode, setMode] = useState("choose"); // choose | new | existing
  return (
    <Overlay onClose={onClose}>
      <div className="panel" style={{ width: 640, maxWidth: "94vw", maxHeight: "90vh", overflow: "auto", padding: "1.5rem" }}>
        {mode === "choose" && <ChooseMode onPick={setMode} onClose={onClose} />}
        {mode === "new" && <NewInstall onBack={() => setMode("choose")} onClose={onClose} onDone={onDone} />}
        {mode === "existing" && <ExistingInstall onBack={() => setMode("choose")} onClose={onClose} onDone={onDone} />}
      </div>
    </Overlay>
  );
}

function ChooseMode({ onPick, onClose }) {
  return (
    <div>
      <Header title="Add a world" onClose={onClose} />
      <p className="subtle" style={{ fontWeight: 600, marginTop: 0, marginBottom: "1.2rem" }}>
        Install a fresh Palworld dedicated server, or register a server you already have on disk.
      </p>
      <div style={{ display: "grid", gap: "0.7rem" }}>
        <ModeCard icon="download" title="Install new server"
          desc="Download the dedicated server with SteamCMD into a folder you choose."
          onClick={() => onPick("new")} />
        <ModeCard icon="folder" title="Use existing install"
          desc="Point to a PalServer folder you already downloaded. No re-download."
          onClick={() => onPick("existing")} />
      </div>
    </div>
  );
}

function ModeCard({ icon, title, desc, onClick }) {
  return (
    <button onClick={onClick} className="panel-inset"
      style={{ textAlign: "left", padding: "1rem", display: "flex", gap: "0.9rem", alignItems: "center", cursor: "pointer", border: "1px solid var(--line)" }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--line)")}>
      <div style={{ width: 42, height: 42, borderRadius: 8, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={icon} size={22} />
      </div>
      <div>
        <div className="heading" style={{ fontSize: "1rem" }}>{title}</div>
        <div className="subtle" style={{ fontSize: "0.82rem", fontWeight: 600 }}>{desc}</div>
      </div>
    </button>
  );
}

function usePorts() {
  const [ports, setPorts] = useState(null);
  useEffect(() => { api("/api/ports").then((r) => setPorts(r.ports)).catch(() => {}); }, []);
  return [ports, setPorts];
}

function PortGrid({ ports, setPorts }) {
  if (!ports) return null;
  return (
    <div className="panel-inset" style={{ padding: "0.8rem", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "0.6rem" }}>
      <PortField label="Game (UDP)" v={ports.game_port} onChange={(v) => setPorts({ ...ports, game_port: v, query_port: v + 1 })} />
      <PortField label="Query" v={ports.query_port} onChange={(v) => setPorts({ ...ports, query_port: v })} />
      <PortField label="REST (TCP)" v={ports.rest_api_port} onChange={(v) => setPorts({ ...ports, rest_api_port: v })} />
      <PortField label="RCON (legacy)" v={ports.rcon_port} onChange={(v) => setPorts({ ...ports, rcon_port: v })} />
    </div>
  );
}

/* ---------- Install new (SteamCMD) ---------- */
function NewInstall({ onBack, onClose, onDone }) {
  const [name, setName] = useState("My Palworld World");
  const [dir, setDir] = useState("");
  const [ports, setPorts] = usePorts();
  const [password, setPassword] = useState("");
  const [starting, setStarting] = useState(false);
  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;

  const pickDir = async () => {
    if (isElectron) { const p = await window.desktop.pickDirectory(); if (p) setDir(p); }
    else toast("Type the full server folder path (native picker is in the desktop app).");
  };

  // Start the install, then hand off to the global downloads tray so progress
  // is visible everywhere (and the modal is never a trap).
  const start = async () => {
    if (!dir.trim()) return toast("Choose an install folder first", "error");
    setStarting(true);
    try {
      await api("/api/provision", { method: "POST", body: { display_name: name, install_dir: dir.trim(), ports, admin_password: password || undefined } });
      try { window.__palJobsPing?.(); } catch {}
      toast("Install started — track progress in the downloads tray", "success");
      onDone();
    } catch (e) { toast(e.message, "error"); setStarting(false); }
  };

  return (
    <div>
      <Header title="Install new server" onClose={onClose} onBack={onBack} />
      <div style={{ display: "grid", gap: "0.9rem" }}>
        <Field label="World name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Install folder" hint="SteamCMD installs the dedicated server (app 2394010) here. Each world needs its own folder.">
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input className="input" value={dir} onChange={(e) => setDir(e.target.value)} placeholder={isElectron ? "Click Browse to choose a folder" : "e.g. C:\\PalworldServers\\world1"} />
            <button className="btn btn-ghost" onClick={pickDir}><Icon name="folder" /> Browse</button>
          </div>
        </Field>
        <PortGrid ports={ports} setPorts={setPorts} />
        <Field label="Admin password" hint="Leave blank to auto-generate. Used for REST API + RCON auth.">
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Actions>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={start} disabled={starting}><Icon name="download" /> {starting ? "Starting…" : "Install server"}</button>
        </Actions>
      </div>
    </div>
  );
}

/* ---------- Use existing install ---------- */
function ExistingInstall({ onBack, onClose, onDone }) {
  const [dir, setDir] = useState("");
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);
  const [name, setName] = useState("");
  const [ports, setPorts] = usePorts();
  const [keepPw, setKeepPw] = useState(true);
  const [saving, setSaving] = useState(false);
  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;

  const pick = async () => {
    if (isElectron) { const p = await window.desktop.pickDirectory(); if (p) { setDir(p); detect(p); } }
    else toast("Type the full server folder path (native picker is in the desktop app).");
  };

  const detect = async (p) => {
    const target = (p || dir).trim();
    if (!target) return toast("Enter a folder path first", "error");
    setChecking(true); setInfo(null);
    try {
      const { info } = await api(`/api/detect?path=${encodeURIComponent(target)}`);
      setInfo(info);
      if (info.valid) setName(info.serverName || "Existing World");
    } catch (e) { toast(e.message, "error"); }
    finally { setChecking(false); }
  };

  const adopt = async () => {
    setSaving(true);
    try {
      await api("/api/adopt", { method: "POST", body: { display_name: name, install_dir: info.installDir, ports, keepExistingPassword: keepPw } });
      toast("Existing server registered", "success");
      onDone();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <Header title="Use existing install" onClose={onClose} onBack={onBack} />
      <Field label="Server folder or PalServer path" hint="Point to the folder containing PalServer.exe (Windows) or PalServer.sh (Linux).">
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input className="input" value={dir} onChange={(e) => setDir(e.target.value)}
            placeholder={isElectron ? "Click Browse to choose the folder" : "e.g. C:\\SteamLibrary\\steamapps\\common\\PalServer"}
            onKeyDown={(e) => e.key === "Enter" && detect()} />
          <button className="btn btn-ghost" onClick={pick}><Icon name="folder" /> Browse</button>
          <button className="btn btn-subtle" onClick={() => detect()} disabled={checking}>{checking ? "Checking…" : "Detect"}</button>
        </div>
      </Field>

      {info && !info.valid && (
        <div className="panel-inset" style={{ padding: "0.7rem 0.9rem", borderLeft: "3px solid var(--red)", marginBottom: "1rem", fontWeight: 600, fontSize: "0.86rem" }}>
          {info.reason}
        </div>
      )}

      {info && info.valid && (
        <div style={{ display: "grid", gap: "0.9rem" }}>
          <div className="panel-inset" style={{ padding: "0.8rem 0.9rem", borderLeft: "3px solid var(--green-bright)" }}>
            <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 4 }}>✓ Palworld server detected</div>
            <div className="subtle" style={{ fontSize: "0.8rem", fontWeight: 600, display: "grid", gap: 2 }}>
              <span>Binary: {info.binaryOs === "win32" ? "PalServer.exe" : "PalServer.sh"}</span>
              <span>Build id: {info.buildId || "unknown (no Steam manifest)"}</span>
              <span>Existing save: {info.hasExistingSave ? "yes" : "none"}</span>
              {!info.matchesHostOs && <span style={{ color: "var(--yellow)" }}>⚠ This build targets a different OS than this machine.</span>}
            </div>
          </div>
          <Field label="World name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <PortGrid ports={ports} setPorts={setPorts} />
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, fontSize: "0.86rem", cursor: "pointer" }}>
            <input type="checkbox" checked={keepPw} onChange={(e) => setKeepPw(e.target.checked)} />
            Keep the server&apos;s existing admin password (from its settings file)
          </label>
          <Actions>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={adopt} disabled={saving}><Icon name="plus" /> {saving ? "Adding…" : "Add this server"}</button>
          </Actions>
        </div>
      )}
    </div>
  );
}

/* ---------- small shared bits ---------- */
function Header({ title, onClose, onBack }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginBottom: "1.1rem" }}>
      {onBack && <button className="btn btn-subtle" style={{ padding: "0.4rem 0.6rem" }} onClick={onBack}><Icon name="back" size={16} /></button>}
      <h2 className="heading" style={{ fontSize: "1.25rem", margin: 0, flex: 1 }}>{title}</h2>
    </div>
  );
}
function Field({ label, hint, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="subtle" style={{ fontSize: "0.74rem", fontWeight: 600, marginTop: 4, marginBottom: 0 }}>{hint}</p>}
    </div>
  );
}
function Actions({ children }) {
  return <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "0.4rem" }}>{children}</div>;
}
function PortField({ label, v, onChange }) {
  return (
    <div>
      <label className="label" style={{ fontSize: "0.62rem" }}>{label}</label>
      <input className="input" type="number" value={v} onChange={(e) => onChange(parseInt(e.target.value || "0", 10))} style={{ padding: "0.35rem 0.5rem" }} />
    </div>
  );
}
export function Overlay({ children, onClose }) {
  return (
    <div onClick={onClose || undefined} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", zIndex: 40, padding: "1rem" }}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
