"use client";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";

// Resize/compress an image file to a data URL under a target size.
function fileToDataURL(file, maxDim, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CustomizeModal({ world, onClose, onDone }) {
  const { t } = useTranslation();
  const downOnBackdrop = useRef(false);
  const [name, setName] = useState(world.display_name || "");
  const [icon, setIcon] = useState(world.icon_data || null);
  const [banner, setBanner] = useState(world.banner_data || null);
  const [accent, setAccent] = useState(world.accent_color || "#5865f2");
  const [saving, setSaving] = useState(false);

  const pickIcon = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { setIcon(await fileToDataURL(f, 256, 0.85)); } catch { toast(t("customize.readError"), "error"); }
  };
  const pickBanner = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { setBanner(await fileToDataURL(f, 900, 0.8)); } catch { toast(t("customize.readError"), "error"); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/worlds/${world.world_id}/customize`, {
        method: "POST",
        body: { display_name: name, icon_data: icon, banner_data: banner, accent_color: accent },
      });
      toast(t("customize.saved"), "success");
      onDone?.();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnBackdrop.current) onClose(); }}>
      <div className="panel animate-floatUp" style={{ width: 560, maxWidth: "94vw", maxHeight: "90vh", overflow: "auto", padding: 0 }}>
        {/* live preview banner */}
        <div style={{ position: "relative", height: 130, background: "var(--bg-2)", overflow: "hidden", borderTopLeftRadius: "inherit", borderTopRightRadius: "inherit" }}>
          {banner && <img src={banner} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 40%, var(--card) 100%)" }} />
          <div style={{ position: "absolute", left: 18, bottom: -22, width: 60, height: 60, borderRadius: 14, overflow: "hidden", border: "3px solid var(--card)", background: icon ? "transparent" : accent, display: "grid", placeItems: "center", boxShadow: "0 4px 14px rgba(0,0,0,0.4)" }}>
            {icon ? <img src={icon} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="globe" size={28} />}
          </div>
        </div>

        <div style={{ padding: "2rem 1.4rem 1.3rem" }}>
          <label className="label">{t("customize.worldName")}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: "1rem" }} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label className="label">{t("customize.profileIcon")}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <label className="btn btn-ghost" style={{ cursor: "pointer", flex: 1 }}>
                  <Icon name="upload" size={15} /> {t("customize.upload")}
                  <input type="file" accept="image/*" hidden onChange={pickIcon} />
                </label>
                {icon && <button className="btn btn-ghost" onClick={() => setIcon(null)} title={t("customize.removeTitle")}><Icon name="trash" size={15} /></button>}
              </div>
            </div>
            <div>
              <label className="label">{t("customize.banner")}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <label className="btn btn-ghost" style={{ cursor: "pointer", flex: 1 }}>
                  <Icon name="upload" size={15} /> {t("customize.upload")}
                  <input type="file" accept="image/*" hidden onChange={pickBanner} />
                </label>
                {banner && <button className="btn btn-ghost" onClick={() => setBanner(null)} title={t("customize.removeTitle")}><Icon name="trash" size={15} /></button>}
              </div>
            </div>
          </div>

          <label className="label">{t("customize.accentColor")} <span className="subtle" style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>{t("customize.accentColorHint")}</span></label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "1.4rem" }}>
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ width: 48, height: 38, border: "1px solid var(--line)", borderRadius: 8, background: "none", cursor: "pointer" }} />
            <code style={{ fontWeight: 700 }}>{accent}</code>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button className="btn btn-ghost" onClick={onClose}>{t("customize.cancel")}</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}><Icon name="download" /> {saving ? t("customize.saving") : t("customize.save")}</button>
          </div>
          <p className="subtle" style={{ fontSize: "0.7rem", fontWeight: 600, marginTop: 10, marginBottom: 0 }}>
            {t("customize.footer")}
          </p>
        </div>
      </div>
    </div>
  );
}
