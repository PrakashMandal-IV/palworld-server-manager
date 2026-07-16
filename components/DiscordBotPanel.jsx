"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";

// Set up a world's own Discord bot: paste a token, invite it, link it with /authorize
// in Discord, then choose who is allowed to drive the server.
//
// The token is write-only from here on: the server hands back only a masked hint, so
// there is nothing to read back out of the page once it's saved.
export default function DiscordBotPanel({ world }) {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState({ connected: false });
  const [roles, setRoles] = useState([]);
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api(`/api/worlds/${world.world_id}/discord-bot`);
      setCfg(r.config);
      setStatus(r.status || { connected: false });
      if (r.config && r.config.authorized) {
        const rr = await api(`/api/worlds/${world.world_id}/discord-bot/roles`).catch(() => ({ roles: [] }));
        setRoles(rr.roles || []);
      }
    } catch (e) { toast(e.message, "error"); }
  }, [world.world_id]);

  useEffect(() => { load(); }, [load]);
  // The link only completes once someone runs /authorize over in Discord, so poll
  // while we're waiting rather than making them reload the page to see it land.
  useEffect(() => {
    if (!cfg || !cfg.hasToken || cfg.authorized) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [cfg, load]);

  const save = async (body, okMsg) => {
    setBusy(true);
    try {
      const r = await api(`/api/worlds/${world.world_id}/discord-bot`, { method: "POST", body });
      setCfg(r.config);
      setStatus(r.status || { connected: false });
      if (okMsg) toast(okMsg, "success");
      return true;
    } catch (e) { toast(e.message, "error"); return false; }
    finally { setBusy(false); }
  };

  const saveToken = async () => {
    if (!token.trim()) return;
    const ok = await save({ token: token.trim() }, t("bot.tokenSaved"));
    if (ok) setToken(""); // never leave the secret sitting in the field
  };

  const removeBot = async () => {
    if (!confirm(t("bot.confirmRemove"))) return;
    setBusy(true);
    try {
      await api(`/api/worlds/${world.world_id}/discord-bot`, { method: "DELETE" });
      setToken("");
      await load();
      toast(t("bot.removed"), "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const toggleRole = (id) => {
    const next = cfg.allowedRoles.includes(id)
      ? cfg.allowedRoles.filter((r) => r !== id)
      : [...cfg.allowedRoles, id];
    save({ allowedRoles: next });
  };
  const addUser = () => {
    const id = userId.trim();
    if (!/^\d{5,25}$/.test(id)) { toast(t("bot.badUserId"), "error"); return; }
    if (cfg.allowedUsers.includes(id)) { setUserId(""); return; }
    save({ allowedUsers: [...cfg.allowedUsers, id] });
    setUserId("");
  };
  const removeUser = (id) => save({ allowedUsers: cfg.allowedUsers.filter((u) => u !== id) });

  if (!cfg) return <div className="panel" style={{ padding: "1.3rem" }}><span className="subtle">{t("common.loading")}</span></div>;

  const step = { marginTop: 0, fontSize: "1.05rem" };
  const panel = { padding: "1.3rem", marginBottom: "1rem" };

  return (
    <div>
      {/* ---- step 1: the token ---- */}
      <div className="panel" style={panel}>
        <h3 className="heading" style={step}>{t("bot.step1Title")}</h3>
        <p className="subtle" style={{ fontSize: "0.8rem" }}>
          <Trans i18nKey="bot.step1Desc" components={{ b: <b />, guide: <Link href="/info#discord-bot" className="link" /> }} />
        </p>
        {cfg.hasToken ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <code style={{ fontSize: "0.8rem" }}>{cfg.tokenHint}</code>
            {cfg.botUsername && <span className="subtle" style={{ fontSize: "0.78rem" }}>{cfg.botUsername}</span>}
            <span className={`chip ${status.connected ? "chip-ok" : ""}`} style={{ fontSize: "0.72rem" }}>
              {status.connected ? t("bot.online") : t("bot.offline")}
            </span>
            <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={removeBot} disabled={busy}>
              {t("bot.remove")}
            </button>
          </div>
        ) : null}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.7rem", maxWidth: 560 }}>
          <input
            className="input" type="password" autoComplete="off" spellCheck={false}
            placeholder={cfg.hasToken ? t("bot.tokenReplace") : t("bot.tokenPlaceholder")}
            value={token} onChange={(e) => setToken(e.target.value)}
          />
          <button className="btn btn-primary" onClick={saveToken} disabled={busy || !token.trim()}>{t("common.save")}</button>
        </div>
      </div>

      {/* ---- step 2: invite it ---- */}
      {cfg.hasToken && (
        <div className="panel" style={panel}>
          <h3 className="heading" style={step}>{t("bot.step2Title")}</h3>
          <p className="subtle" style={{ fontSize: "0.8rem" }}>{t("bot.step2Desc")}</p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <a className="btn btn-primary" href={cfg.inviteUrl} target="_blank" rel="noreferrer" style={{ padding: "0.35rem 0.7rem" }}>
              <Icon name="globe" size={15} /> {t("bot.openInvite")}
            </a>
            <button
              className="btn btn-ghost" style={{ padding: "0.35rem 0.7rem" }}
              onClick={() => { navigator.clipboard.writeText(cfg.inviteUrl); toast(t("bot.linkCopied"), "success"); }}
            >
              {t("bot.copyInvite")}
            </button>
          </div>
        </div>
      )}

      {/* ---- step 3: link it from Discord ---- */}
      {cfg.hasToken && (
        <div className="panel" style={panel}>
          <h3 className="heading" style={step}>{t("bot.step3Title")}</h3>
          {cfg.authorized ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
              <span className="chip chip-ok" style={{ fontSize: "0.72rem" }}>{t("bot.linked")}</span>
              <span className="subtle" style={{ fontSize: "0.8rem", fontWeight: 600 }}>{cfg.guildName || cfg.guildId}</span>
              <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={() => save({ unlink: true }, t("bot.unlinked"))} disabled={busy}>
                {t("bot.unlink")}
              </button>
            </div>
          ) : (
            <p className="subtle" style={{ fontSize: "0.8rem", marginBottom: 0 }}>
              <Trans i18nKey="bot.step3Desc" components={{ b: <b />, code: <code /> }} />
            </p>
          )}
        </div>
      )}

      {/* ---- step 4: who may use it ---- */}
      {cfg.authorized && (
        <div className="panel" style={panel}>
          <h3 className="heading" style={step}>{t("bot.step4Title")}</h3>
          <p className="subtle" style={{ fontSize: "0.8rem" }}>
            <Trans i18nKey="bot.step4Desc" components={{ b: <b /> }} />
          </p>

          <label className="label">{t("bot.roles")}</label>
          {roles.length === 0 && <p className="subtle" style={{ fontSize: "0.78rem" }}>{t("bot.noRoles")}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.9rem" }}>
            {roles.map((r) => (
              <button
                key={r.id} onClick={() => toggleRole(r.id)} disabled={busy}
                className={`btn ${cfg.allowedRoles.includes(r.id) ? "btn-primary" : "btn-ghost"}`}
                style={{ padding: "0.25rem 0.6rem", fontSize: "0.78rem" }}
              >
                @{r.name}
              </button>
            ))}
          </div>

          <label className="label">{t("bot.people")}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.5rem" }}>
            {cfg.allowedUsers.map((u) => (
              <span key={u} className="chip" style={{ fontSize: "0.75rem" }}>
                {u}{u === cfg.authorizedBy ? ` · ${t("bot.youLinkedIt")}` : ""}
                <button onClick={() => removeUser(u)} disabled={busy} className="btn btn-ghost" style={{ padding: "0 0.3rem", marginLeft: "0.3rem" }}>×</button>
              </span>
            ))}
            {cfg.allowedUsers.length === 0 && <span className="subtle" style={{ fontSize: "0.78rem" }}>{t("bot.noUsers")}</span>}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", maxWidth: 420 }}>
            <input className="input" placeholder={t("bot.userIdPlaceholder")} value={userId} onChange={(e) => setUserId(e.target.value)} />
            <button className="btn" onClick={addUser} disabled={busy || !userId.trim()}>{t("common.add")}</button>
          </div>
          <p className="subtle" style={{ fontSize: "0.75rem", marginTop: "0.5rem", marginBottom: 0 }}>
            <Trans i18nKey="bot.userIdHint" components={{ b: <b /> }} />
          </p>

          {cfg.allowedRoles.length === 0 && cfg.allowedUsers.length === 0 && (
            <p style={{ fontSize: "0.78rem", marginBottom: 0, marginTop: "0.7rem" }}>
              <b>{t("bot.nobodyWarn")}</b>
            </p>
          )}
        </div>
      )}

      {/* ---- what the commands are ---- */}
      {cfg.authorized && (
        <div className="panel" style={panel}>
          <h3 className="heading" style={step}>{t("bot.commandsTitle")}</h3>
          <ul className="subtle" style={{ fontSize: "0.8rem", marginBottom: 0, paddingLeft: "1.1rem" }}>
            <li><code>/start</code> · <code>/stop</code> · <code>/restart</code> — {t("bot.cmdLifecycle")}</li>
            <li><code>/broadcast</code> — {t("bot.cmdBroadcast")}</li>
            <li><code>/backup</code> — {t("bot.cmdBackup")}</li>
          </ul>
          <p className="subtle" style={{ fontSize: "0.75rem", marginTop: "0.7rem", marginBottom: 0 }}>{t("bot.appMustRun")}</p>
        </div>
      )}
    </div>
  );
}
