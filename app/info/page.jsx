"use client";
import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { Icon } from "@/components/ui";

const GUIDES = [
  { id: "internet", titleKey: "info.guideInternetTitle", subtitleKey: "info.guideInternetSubtitle", icon: "globe" },
  { id: "discord-bot", titleKey: "info.guideBotTitle", subtitleKey: "info.guideBotSubtitle", icon: "chat" },
];

export default function InfoPage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState("internet");
  return (
    <div>
      <h1 className="heading" style={{ fontSize: "1.8rem", marginBottom: "0.3rem" }}>{t("info.title")}</h1>
      <p className="subtle" style={{ fontWeight: 600, marginBottom: "1.4rem" }}>{t("info.subtitle")}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        {GUIDES.map((g) => (
          <div key={g.id} className="panel" style={{ overflow: "hidden" }}>
            <button onClick={() => setOpen(open === g.id ? null : g.id)}
              style={{ width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: "1rem 1.2rem", display: "flex", alignItems: "center", gap: "0.9rem", textAlign: "left", color: "var(--ink)" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--accent)", display: "grid", placeItems: "center", color: "#fff", flexShrink: 0 }}>
                <Icon name={g.icon} size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="heading" style={{ fontSize: "1.05rem" }}>{t(g.titleKey)}</div>
                <div className="subtle" style={{ fontSize: "0.8rem", fontWeight: 600 }}>{t(g.subtitleKey)}</div>
              </div>
              <Icon name={open === g.id ? "chevronDown" : "chevronRight"} size={18} />
            </button>
            {open === g.id && g.id === "internet" && <PlayitGuide />}
            {open === g.id && g.id === "discord-bot" && <DiscordBotGuide />}
          </div>
        ))}
      </div>
    </div>
  );
}

// Making a Discord bot is a handful of clicks in Discord's developer portal, but the
// portal assumes you already know the words. This walks through it in order.
function DiscordBotGuide() {
  const { t } = useTranslation();
  const open = () => window.open("https://discord.com/developers/applications", "_blank", "noopener");
  return (
    <div className="tab-content" style={{ padding: "0 1.2rem 1.4rem", borderTop: "1px solid var(--line)" }}>
      <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", margin: "1.1rem 0", borderLeft: "3px solid var(--accent)" }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("info.whatIsBot")}</div>
        <div className="subtle" style={{ fontWeight: 600, fontSize: "0.85rem" }}>{t("info.whatIsBotDesc")}</div>
      </div>

      <button className="btn btn-primary" onClick={open} style={{ marginBottom: "1.2rem" }}>
        <Icon name="globe" size={16} /> {t("info.openPortal")}
      </button>

      <Step n="1" title={t("info.bot1Title")}><Trans i18nKey="info.bot1" components={{ b: <b /> }} /></Step>
      <Step n="2" title={t("info.bot2Title")}><Trans i18nKey="info.bot2" components={{ b: <b /> }} /></Step>
      <Step n="3" title={t("info.bot3Title")}><Trans i18nKey="info.bot3" components={{ b: <b /> }} /></Step>
      <Step n="4" title={t("info.bot4Title")}><Trans i18nKey="info.bot4" components={{ b: <b /> }} /></Step>
      <Step n="5" title={t("info.bot5Title")}><Trans i18nKey="info.bot5" components={{ b: <b />, code: <code /> }} /></Step>
      <Step n="6" title={t("info.bot6Title")}><Trans i18nKey="info.bot6" components={{ b: <b /> }} /></Step>

      <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", marginTop: "1.1rem", borderLeft: "3px solid var(--warn, var(--accent))" }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("info.botSafetyTitle")}</div>
        <div className="subtle" style={{ fontWeight: 600, fontSize: "0.85rem" }}>
          <Trans i18nKey="info.botSafety" components={{ b: <b /> }} />
        </div>
      </div>
    </div>
  );
}

function PlayitGuide() {
  const { t } = useTranslation();
  const openPlayit = () => window.open("https://playit.gg", "_blank", "noopener");
  return (
    <div className="tab-content" style={{ padding: "0 1.2rem 1.4rem", borderTop: "1px solid var(--line)" }}>
      <div className="panel-inset" style={{ padding: "0.9rem 1.1rem", margin: "1.1rem 0", borderLeft: "3px solid var(--accent)" }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("info.whatIsPlayit")}</div>
        <div className="subtle" style={{ fontWeight: 600, fontSize: "0.85rem" }}>
          {t("info.whatIsPlayitDesc")}
        </div>
      </div>

      <button className="btn btn-primary" onClick={openPlayit} style={{ marginBottom: "1.2rem" }}>
        <Icon name="globe" size={16} /> {t("info.openPlayit")}
      </button>

      <Step n="1" title={t("info.step1Title")}>
        <Trans i18nKey="info.step1" components={{ b: <b /> }} />
      </Step>
      <Step n="2" title={t("info.step2Title")}>
        <Trans i18nKey="info.step2" components={{ b: <b /> }} />
      </Step>
      <Step n="3" title={t("info.step3Title")}>
        <Trans i18nKey="info.step3" components={{ b: <b /> }} />
      </Step>
      <Step n="4" title={t("info.step4Title")}>
        <Trans i18nKey="info.step4" components={{ b: <b /> }} />
      </Step>
      <Step n="5" title={t("info.step5Title")}>
        <Trans i18nKey="info.step5" components={{ b: <b /> }} />
      </Step>
      <Step n="6" title={t("info.step6Title")}>
        {t("info.step6Intro")}
        <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem", lineHeight: 1.7 }}>
          <li><Trans i18nKey="info.step6LocalIp" components={{ b: <b />, code: <code /> }} /></li>
          <li><Trans i18nKey="info.step6LocalPort" components={{ b: <b />, code: <code /> }} /></li>
        </ul>
      </Step>
      <Step n="7" title={t("info.step7Title")} last>
        <Trans i18nKey="info.step7" components={{ b: <b /> }} />
      </Step>
    </div>
  );
}

function Step({ n, title, children, last }) {
  return (
    <div style={{ display: "flex", gap: "0.9rem", paddingBottom: last ? 0 : "1rem" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 28, height: 28, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0 }}>{n}</div>
        {!last && <div style={{ flex: 1, width: 2, background: "var(--line)", marginTop: 4 }} />}
      </div>
      <div style={{ paddingTop: 2 }}>
        <div className="heading" style={{ fontSize: "0.98rem", marginBottom: 2 }}>{title}</div>
        <div className="subtle" style={{ fontWeight: 600, fontSize: "0.86rem", lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  );
}
