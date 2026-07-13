"use client";
import { useEffect, useState, useMemo } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";
import IniEditor from "@/components/IniEditor";

// Community-tested starting presets (from published Palworld tuning guides).
// Applying one just stages the changes in the editor; you still review + save.
const PRESETS = {
  "Casual PvE": { EnemyDropItemRate: 1.25, CollectionDropRate: 1.15, DeathPenalty: "Item", SupplyDropSpan: 50, PalSpawnNumRate: 1.0, ServerPlayerMaxNum: 20 },
  "Balanced PvP": { EnemyDropItemRate: 1.05, CollectionDropRate: 1.0, DeathPenalty: "ItemAndEquipment", SupplyDropSpan: 60, PalSpawnNumRate: 1.0, ServerPlayerMaxNum: 40 },
  "Small-group PvP": { EnemyDropItemRate: 1.1, CollectionDropRate: 1.05, DeathPenalty: "Item", SupplyDropSpan: 55, PalSpawnNumRate: 1.0, ServerPlayerMaxNum: 24 },
};

// Decode a raw ini value (string) into a typed JS value for the control.
function decode(type, raw, def) {
  if (raw == null) return def;
  let v = String(raw).trim();
  if (type === "tuple") return v;
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (v === "") return type === "text" ? "" : def;
  if (type === "bool") return v.toLowerCase() === "true";
  if (type === "int") return parseInt(v, 10);
  if (type === "float") return parseFloat(v);
  return v;
}
// Encode a typed JS value back into the ini string form.
function encode(type, val) {
  if (type === "bool") return val ? "True" : "False";
  if (type === "tuple") return val;
  if (type === "text" || type === "select") return `"${val}"`;
  return String(val);
}

export default function SettingsEditor({ worldId, world, running, onGoToAdmin }) {
  const { t } = useTranslation();
  const [iniOpen, setIniOpen] = useState(false);
  const [groups, setGroups] = useState(null);
  const [saved, setSaved] = useState({});      // typed values reflecting the ini on disk
  const [present, setPresent] = useState(new Set()); // keys actually written in the ini
  const [draft, setDraft] = useState({});      // current control values
  const [touched, setTouched] = useState(new Set()); // fields the user interacted with
  const [exists, setExists] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeGroup, setActiveGroup] = useState(0);
  const [search, setSearch] = useState("");

  const load = async () => {
    const r = await api(`/api/worlds/${worldId}/settings`);
    setGroups(r.groups);
    setExists(r.exists);
    setPresent(new Set(r.presentKeys || []));
    const typed = {};
    for (const g of r.groups) for (const f of g.fields) {
      typed[f.key] = decode(f.type, r.options[f.key], f.default);
    }
    setSaved(typed);
    setDraft(typed);
    setTouched(new Set());
  };
  useEffect(() => { load().catch((e) => toast(e.message, "error")); }, [worldId]);

  // Which fields differ from what's saved on disk = the user's actual edits.
  // A field also counts as changed if the user explicitly interacted with it
  // (touched) AND its value isn't already written in the ini — this lets you
  // force-write a setting that currently shows the game default (e.g. enabling
  // fast travel on a server whose ini doesn't list it yet).
  const changedKeys = useMemo(() => {
    const out = [];
    for (const k of Object.keys(draft)) {
      const differs = JSON.stringify(draft[k]) !== JSON.stringify(saved[k]);
      const forced = touched.has(k) && !present.has(k);
      if (differs || forced) out.push(k);
    }
    return out;
  }, [draft, saved, touched, present]);

  const fieldType = useMemo(() => {
    const m = {};
    if (groups) for (const g of groups) for (const f of g.fields) m[f.key] = f.type;
    return m;
  }, [groups]);

  const save = async () => {
    if (changedKeys.length === 0) { toast(t("editor.noChanges"), "info"); return; }
    setSaving(true);
    try {
      const changed = {};
      for (const k of changedKeys) changed[k] = encode(fieldType[k], draft[k]);
      const r = await api(`/api/worlds/${worldId}/settings`, { method: "POST", body: { changed } });
      toast(t("editor.savedChanges", { count: changedKeys.length }), "success");
      await load();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const setVal = (key, val) => {
    setDraft((d) => ({ ...d, [key]: val }));
    setTouched((prev) => new Set(prev).add(key));
  };

  // Export current settings as a downloaded zip (saved to the browser's default
  // download location).
  const exportSettings = () => {
    const a = document.createElement("a");
    a.href = `/api/worlds/${worldId}/settings/export`;
    a.download = "";
    document.body.appendChild(a); a.click(); a.remove();
    toast(t("editor.exporting"), "info");
  };

  const importSettings = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const zipBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const r = await api(`/api/worlds/${worldId}/settings/import`, { method: "POST", body: { zipBase64 } });
      toast(t("editor.imported", { count: r.applied }), "success");
      await load();
    } catch (err) { toast(err.message, "error"); }
    finally { e.target.value = ""; }
  };

  const applyPreset = (name) => {
    const preset = PRESETS[name];
    if (!preset) return;
    setDraft((d) => ({ ...d, ...preset }));
    setTouched((prev) => { const n = new Set(prev); for (const k of Object.keys(preset)) n.add(k); return n; });
    toast(t("editor.presetApplied", { name }), "info");
  };
  const resetField = (f) => setDraft((d) => ({ ...d, [f.key]: saved[f.key] })); // revert to disk value

  if (!groups) return <p className="subtle" style={{ fontWeight: 600 }}>{t("editor.loading")}</p>;

  const filtering = search.trim().length > 0;
  const q = search.toLowerCase();
  const visibleGroups = filtering
    ? groups.map((g) => ({ ...g, fields: g.fields.filter((f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q)) })).filter((g) => g.fields.length)
    : [groups[activeGroup]];

  return (
    <div>
      {!exists && <Notice color="var(--yellow)">{t("editor.noFileNotice")}</Notice>}
      <Notice color="var(--accent)">
        <Icon name="clock" size={14} /> <Trans i18nKey="editor.onlyChangedNotice" components={{ b: <b /> }} />
      </Notice>
      {changedKeys.length > 0 && (
        <Notice color="var(--green)">
          <Trans i18nKey="editor.unsavedNotice" count={changedKeys.length}
            values={{ keys: changedKeys.slice(0, 6).join(", ") + (changedKeys.length > 6 ? "…" : "") }}
            components={{ b: <b /> }} />
        </Notice>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" placeholder={t("editor.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 240 }} />
        <span className="subtle" style={{ fontSize: "0.72rem", fontWeight: 700 }}>{t("editor.presets")}</span>
        {Object.keys(PRESETS).map((name) => (
          <button key={name} className="btn btn-subtle" style={{ padding: "0.35rem 0.7rem", fontSize: "0.78rem" }} onClick={() => applyPreset(name)}>
            {name}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}>
          <button className="btn btn-ghost" style={{ padding: "0.35rem 0.7rem", fontSize: "0.78rem" }} onClick={exportSettings}>
            <Icon name="upload" size={14} /> {t("editor.export")}
          </button>
          <label className="btn btn-ghost" style={{ padding: "0.35rem 0.7rem", fontSize: "0.78rem", cursor: "pointer" }}>
            <Icon name="download" size={14} /> {t("editor.import")}
            <input type="file" accept=".zip" hidden onChange={importSettings} />
          </label>
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        {!filtering && (
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {groups.map((g, i) => (
              <button key={g.title} className={`btn ${activeGroup === i ? "btn-primary" : "btn-subtle"}`} style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }} onClick={() => setActiveGroup(i)}>
                {g.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {visibleGroups.map((g) => (
        <div key={g.title} style={{ marginBottom: filtering ? "1.4rem" : 0 }}>
          {filtering && <h4 className="heading" style={{ fontSize: "0.85rem", margin: "0 0 0.6rem", color: "var(--ink-soft)" }}>{g.title}</h4>}
          {/* Public IP/port only matter once the server is publicly listed. Nudge the
              user to turn that on — but only while it's still off. */}
          {g.title === "Server Identity" && world && !world.community_server && (
            <Notice color="var(--yellow)">
              <Icon name="alert" size={14} /> <Trans i18nKey="editor.communityNotice" components={{ b: <b /> }} />
              {onGoToAdmin && (
                <button className="btn btn-subtle" style={{ padding: "0.2rem 0.6rem", fontSize: "0.74rem", marginLeft: "auto" }} onClick={onGoToAdmin}>
                  {t("editor.goToAdmin")}
                </button>
              )}
            </Notice>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.9rem" }}>
            {g.fields.map((f) => {
              const isChanged = JSON.stringify(draft[f.key]) !== JSON.stringify(saved[f.key]);
              const isSet = present.has(f.key);
              return (
                <div key={f.key} style={isChanged ? { outline: "1px solid var(--green)", outlineOffset: 4, borderRadius: 4 } : undefined}>
                  <label className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span title={f.key}>
                      {f.label}
                      {!isSet && <span className="subtle" style={{ fontWeight: 700, fontSize: "0.6rem", marginLeft: 5 }} title={t("editor.defaultTitle")}>{t("editor.default")}</span>}
                    </span>
                    {isChanged && (
                      <button onClick={() => resetField(f)} title={t("editor.revertTitle")}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--green)", fontSize: "0.62rem", fontWeight: 800, padding: 0 }}>
                        {t("editor.revert")}
                      </button>
                    )}
                  </label>
                  {f.type === "bool" ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className={`btn ${draft[f.key] === false ? "btn-primary" : "btn-ghost"}`} style={{ flex: 1 }} onClick={() => setVal(f.key, false)}>{t("editor.off")}</button>
                      <button className={`btn ${draft[f.key] === true ? "btn-primary" : "btn-ghost"}`} style={{ flex: 1 }} onClick={() => setVal(f.key, true)}>{t("editor.on")}</button>
                    </div>
                  ) : f.type === "select" ? (
                    <select className="input" value={draft[f.key] ?? f.default} onChange={(e) => setVal(f.key, e.target.value)}>
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input className="input" type={f.type === "text" || f.type === "tuple" ? "text" : "number"}
                      step={f.type === "float" ? "0.1" : "1"}
                      min={f.min} max={f.max}
                      title={f.hint || f.key}
                      value={draft[f.key] ?? ""}
                      onChange={(e) => {
                        let raw = e.target.value;
                        if (f.type === "text" || f.type === "tuple") return setVal(f.key, raw);
                        if (raw === "") return setVal(f.key, "");
                        let n = Number(raw);
                        if (typeof f.max === "number" && n > f.max) n = f.max;
                        if (typeof f.min === "number" && n < f.min) n = f.min;
                        setVal(f.key, n);
                      }} />
                  )}
                  {f.hint && <div className="subtle" style={{ fontSize: "0.66rem", fontWeight: 600, marginTop: 2 }}>{f.hint}</div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.4rem", gap: "0.6rem", position: "sticky", bottom: 0, background: "var(--card)", paddingTop: "0.8rem" }}>
        <span className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem" }}>
          {changedKeys.length > 0 ? t("editor.changesPending", { count: changedKeys.length }) : t("editor.noChangesLabel")}
        </span>
        <div style={{ display: "flex", gap: "0.6rem" }}>
          <button className="btn btn-ghost" onClick={() => setDraft(saved)} disabled={changedKeys.length === 0}>{t("editor.discard")}</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || changedKeys.length === 0}>
            <Icon name="download" /> {saving ? t("editor.saving") : t("editor.saveChanges")}
          </button>
          {world && (
            <button className="btn btn-subtle" onClick={() => setIniOpen(true)} title={t("editor.iniEditorTitle")}>
              <Icon name="terminal" size={14} /> {t("editor.iniEditor")}
            </button>
          )}
        </div>
      </div>

      {iniOpen && world && (
        <IniEditor
          world={world}
          running={running}
          onClose={() => { setIniOpen(false); load().catch(() => {}); }}
        />
      )}
    </div>
  );
}

function Notice({ color, children }) {
  return (
    <div className="panel-inset" style={{ padding: "0.6rem 0.9rem", borderLeft: `3px solid ${color}`, marginBottom: "0.8rem", fontWeight: 600, fontSize: "0.82rem", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {children}
    </div>
  );
}
