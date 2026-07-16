"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";
// The permission maths is pure and lives with the rules it enforces, so the grid can
// apply a change locally and post it, rather than waiting on a round-trip to redraw.
import { setGrant as nextGrant, grantAll, revokeAll, subjects } from "@/lib/discord-bot-config";

// Who did what, and when. Refusals are in here too — the point of a record like this
// is answering "who tried to stop the server", not only who managed it.
function ActionLog({ world }) {
  const { t } = useTranslation();
  const [data, setData] = useState({ entries: [], actors: [], actions: [] });
  const [f, setF] = useState({ user: "", action: "", result: "", days: "7" });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (f.user) q.set("user", f.user);
      if (f.action) q.set("action", f.action);
      if (f.result) q.set("result", f.result);
      // "All time" is the empty case; anything else is a window ending now.
      if (f.days) q.set("from", String(Date.now() - Number(f.days) * 86400000));
      const r = await api(`/api/worlds/${world.world_id}/discord-bot/log?${q.toString()}`);
      setData({ entries: r.entries || [], actors: r.actors || [], actions: r.actions || [] });
    } catch { /* leave what we had */ }
    finally { setLoading(false); }
  }, [world.world_id, f]);

  useEffect(() => { load(); }, [load]);

  const RESULT_STYLE = {
    ok: { color: "var(--ok, #3ba55d)" },
    denied: { color: "var(--warn, #faa61a)" },
    error: { color: "var(--danger, #ed4245)" },
  };
  // minmax(0,1fr) is what lets them actually share the row: without the 0 floor a long
  // username in the people list would push its column wider and wrap the rest.
  const sel = { padding: "0.3rem 0.4rem", fontSize: "0.78rem", minWidth: 0, width: "100%" };
  const filterRow = {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "0.4rem",
    marginBottom: "0.7rem",
  };

  return (
    <div className="panel" style={{ padding: "1.3rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.2rem" }}>
        <h3 className="heading" style={{ marginTop: 0, fontSize: "1.05rem", flex: 1 }}>{t("bot.logTitle")}</h3>
        <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem", fontSize: "0.78rem" }} onClick={load} disabled={loading}>
          <Icon name="refresh" size={14} /> {t("bot.refresh")}
        </button>
      </div>
      <p className="subtle" style={{ fontSize: "0.78rem" }}>{t("bot.logDesc")}</p>

      <div style={filterRow}>
        <select className="input" style={sel} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })}>
          <option value="1">{t("bot.last24h")}</option>
          <option value="7">{t("bot.last7d")}</option>
          <option value="30">{t("bot.last30d")}</option>
          <option value="">{t("bot.allTime")}</option>
        </select>
        <select className="input" style={sel} value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })}>
          <option value="">{t("bot.anyone")}</option>
          {data.actors.map((a) => (
            <option key={a.user_id} value={a.user_id}>{a.user_name || a.user_id} ({a.n})</option>
          ))}
        </select>
        <select className="input" style={sel} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          <option value="">{t("bot.anyAction")}</option>
          {data.actions.map((a) => <option key={a} value={a}>/{a}</option>)}
        </select>
        <select className="input" style={sel} value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}>
          <option value="">{t("bot.anyResult")}</option>
          <option value="ok">{t("bot.resultOk")}</option>
          <option value="denied">{t("bot.resultDenied")}</option>
          <option value="error">{t("bot.resultError")}</option>
        </select>
      </div>

      {data.entries.length === 0 ? (
        <p className="subtle" style={{ fontSize: "0.78rem", marginBottom: 0 }}>{t("bot.logEmpty")}</p>
      ) : (
        <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
          {data.entries.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", padding: "0.4rem 0.7rem", borderBottom: "1px solid var(--line)", fontSize: "0.78rem" }}>
              <span className="subtle" style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {new Date(e.created_at).toLocaleString()}
              </span>
              <span style={{ fontWeight: 700 }}>{e.user_name || e.user_id}</span>
              <code>/{e.action}</code>
              <span style={{ fontWeight: 700, ...(RESULT_STYLE[e.result] || {}) }}>{t(`bot.result_${e.result}`)}</span>
              {e.detail && <span className="subtle" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Set up a world's own Discord bot: paste a token, invite it, link it with /authorize
// in Discord, then choose who is allowed to drive the server.
//
// The token is write-only from here on: the server hands back only a masked hint, so
// there is nothing to read back out of the page once it's saved.
export default function DiscordBotPanel({ world }) {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState({ connected: false, guilds: 0 });
  const [dir, setDir] = useState({ roles: [], members: [], membersNeedIntent: false });
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Roles and members come from Discord live, so they go stale the moment someone adds
  // a role over there. Kept separate from the config load so Refresh can re-pull just
  // this without disturbing the rest of the page.
  const loadDir = useCallback(async () => {
    try {
      const d = await api(`/api/worlds/${world.world_id}/discord-bot/directory`);
      setDir({ roles: d.roles || [], members: d.members || [], membersNeedIntent: !!d.membersNeedIntent });
    } catch { /* leave whatever we had */ }
  }, [world.world_id]);

  const load = useCallback(async () => {
    try {
      const r = await api(`/api/worlds/${world.world_id}/discord-bot`);
      setCfg(r.config);
      setStatus(r.status || { connected: false, guilds: 0 });
      if (r.config && r.config.authorized) await loadDir();
    } catch (e) { toast(e.message, "error"); }
  }, [world.world_id, loadDir]);

  const refresh = async () => {
    setRefreshing(true);
    try { await loadDir(); toast(t("bot.listRefreshed"), "success"); }
    finally { setRefreshing(false); }
  };

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

  // Apply a permission change on the spot, then tell the server.
  //
  // Waiting for the round-trip meant every click disabled the whole grid and list until
  // it came back, so ticking a few boxes made the panel flash. The maths is the same
  // pure function the server runs, so the optimistic result matches what comes back;
  // if the request fails we put the old config back and say so.
  const applyPerms = async (permissions, body) => {
    const prev = cfg;
    const subs = subjects(permissions);
    setCfg({ ...cfg, permissions, allowedRoles: subs.roles, allowedUsers: subs.users });
    try {
      const r = await api(`/api/worlds/${world.world_id}/discord-bot`, { method: "POST", body });
      setCfg(r.config);
    } catch (e) {
      setCfg(prev);
      toast(e.message, "error");
    }
  };

  // Adding someone means every action — that's what "let them use the bot" means
  // before you narrow it down. Removing takes back the lot.
  const grantSubject = (type, id, grant) =>
    applyPerms(
      grant ? grantAll(cfg.permissions, type, id) : revokeAll(cfg.permissions, type, id),
      { subject: { type, id, grant } }
    );

  // One cell of the grid: this subject, this action, on or off.
  const setGrant = (action, type, id, on) =>
    applyPerms(nextGrant(cfg.permissions, action, type, id, on), { grant: { action, type, id, on } });

  const toggleRole = (id) => grantSubject("role", id, !cfg.allowedRoles.includes(id));
  const toggleUser = (id) => grantSubject("user", id, !cfg.allowedUsers.includes(id));
  const addUser = () => {
    const id = userId.trim();
    if (!/^\d{5,25}$/.test(id)) { toast(t("bot.badUserId"), "error"); return; }
    if (cfg.allowedUsers.includes(id)) { setUserId(""); return; }
    grantSubject("user", id, true);
    setUserId("");
  };
  const removeUser = (id) => grantSubject("user", id, false);

  // Does this subject have this action?
  const has = (action, type, id) =>
    !!cfg && !!cfg.permissions[action] && cfg.permissions[action][type === "role" ? "roles" : "users"].includes(id);

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
          {status.connected && status.guilds === 0 && (
            <p style={{ fontSize: "0.8rem", marginTop: 0 }}><b>{t("bot.notInAnyServer")}</b></p>
          )}
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <h3 className="heading" style={{ ...step, flex: 1 }}>{t("bot.step4Title")}</h3>
            {/* Discord is the source of truth for both lists and they change over there,
                not here — so there has to be a way to re-pull them on demand. */}
            <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem", fontSize: "0.78rem" }} onClick={refresh} disabled={refreshing}>
              <Icon name="refresh" size={14} /> {refreshing ? t("bot.refreshing") : t("bot.refresh")}
            </button>
          </div>
          <p className="subtle" style={{ fontSize: "0.8rem" }}>
            <Trans i18nKey="bot.step4Desc" components={{ b: <b /> }} />
          </p>

          {/* ---- roles: Discord's own order, highest first ---- */}
          <label className="label">{t("bot.roles")}</label>
          {dir.roles.length === 0 && <p className="subtle" style={{ fontSize: "0.78rem" }}>{t("bot.noRoles")}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.9rem" }}>
            {dir.roles.map((r) => {
              const on = cfg.allowedRoles.includes(r.id);
              return (
                <button
                  key={r.id} onClick={() => toggleRole(r.id)}
                  className={`btn ${on ? "btn-primary" : "btn-ghost"}`}
                  style={{ padding: "0.25rem 0.6rem", fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                  title={`@${r.name}`}
                >
                  {r.iconUrl
                    ? <img src={r.iconUrl} alt="" width={14} height={14} style={{ borderRadius: 3 }} />
                    : r.emoji
                      ? <span>{r.emoji}</span>
                      : <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.color || "var(--muted, #99aab5)", display: "inline-block" }} />}
                  @{r.name}
                </button>
              );
            })}
          </div>

          {/* ---- people ---- */}
          <label className="label">{t("bot.people")}</label>

          {/* Already-allowed people, shown even when the member list isn't available so
              they can always be removed. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.6rem" }}>
            {cfg.allowedUsers.map((u) => {
              const m = dir.members.find((x) => x.id === u);
              return (
                <span key={u} className="chip" style={{ fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                  {m && <img src={m.avatarUrl} alt="" width={16} height={16} style={{ borderRadius: "50%" }} />}
                  {m ? m.displayName : u}
                  {m && <span className="subtle">@{m.username}</span>}
                  {u === cfg.authorizedBy ? <span className="subtle">· {t("bot.youLinkedIt")}</span> : null}
                  <button onClick={() => removeUser(u)} disabled={busy} className="btn btn-ghost" style={{ padding: "0 0.3rem" }}>×</button>
                </span>
              );
            })}
            {cfg.allowedUsers.length === 0 && <span className="subtle" style={{ fontSize: "0.78rem" }}>{t("bot.noUsers")}</span>}
          </div>

          {/* ---- the grid: which of them can do what ---- */}
          {(cfg.allowedRoles.length > 0 || cfg.allowedUsers.length > 0) && (
            <div style={{ marginBottom: "1rem", overflowX: "auto" }}>
              <label className="label">{t("bot.whoCanWhat")}</label>
              <p className="subtle" style={{ fontSize: "0.75rem", marginTop: 0 }}>{t("bot.whoCanWhatDesc")}</p>
              <table style={{ borderCollapse: "collapse", fontSize: "0.78rem", minWidth: 460 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.3rem 0.6rem 0.3rem 0" }} />
                    {cfg.actions.map((a) => (
                      <th key={a} style={{ padding: "0.3rem 0.4rem", fontWeight: 700, whiteSpace: "nowrap" }}>/{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...cfg.allowedRoles.map((id) => ({ type: "role", id, label: `@${(dir.roles.find((r) => r.id === id) || {}).name || id}` })),
                    ...cfg.allowedUsers.map((id) => {
                      const m = dir.members.find((x) => x.id === id);
                      return { type: "user", id, label: m ? m.displayName : id, avatar: m && m.avatarUrl };
                    }),
                  ].map((s) => (
                    <tr key={`${s.type}:${s.id}`} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: "0.35rem 0.6rem 0.35rem 0", whiteSpace: "nowrap", fontWeight: 600 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                          {s.avatar && <img src={s.avatar} alt="" width={16} height={16} style={{ borderRadius: "50%" }} />}
                          {s.label}
                        </span>
                      </td>
                      {cfg.actions.map((a) => {
                        const on = has(a, s.type, s.id);
                        return (
                          <td key={a} style={{ padding: "0.2rem 0.4rem", textAlign: "center" }}>
                            <button
                              onClick={() => setGrant(a, s.type, s.id, !on)}
                              aria-label={`${s.label} /${a}`}
                              title={`${s.label} — /${a}`}
                              className={`btn ${on ? "btn-primary" : "btn-ghost"}`}
                              style={{ padding: "0.1rem 0.45rem", fontSize: "0.72rem", minWidth: 30 }}
                            >
                              {on ? "✓" : "–"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {dir.membersNeedIntent ? (
            // Listing members is the one thing that needs a privileged intent. Rather
            // than fail quietly, say what to switch on — and keep the id path working.
            <div className="panel-inset" style={{ padding: "0.8rem 1rem", marginBottom: "0.6rem", borderLeft: "3px solid var(--accent)" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.3rem" }}>{t("bot.needIntentTitle")}</div>
              <div className="subtle" style={{ fontSize: "0.78rem" }}>
                <Trans i18nKey="bot.needIntentDesc" components={{ b: <b />, guide: <Link href="/info#discord-bot" className="link" /> }} />
              </div>
            </div>
          ) : dir.members.length > 0 ? (
            <>
              <input
                className="input" style={{ maxWidth: 320, marginBottom: "0.5rem" }}
                placeholder={t("bot.searchPeople")} value={filter} onChange={(e) => setFilter(e.target.value)}
              />
              <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                {dir.members
                  .filter((m) => !filter.trim() || `${m.displayName} ${m.username}`.toLowerCase().includes(filter.trim().toLowerCase()))
                  .map((m) => {
                    const on = cfg.allowedUsers.includes(m.id);
                    return (
                      <button
                        key={m.id} onClick={() => toggleUser(m.id)}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.45rem 0.7rem",
                          background: on ? "var(--accent)" : "transparent", color: on ? "#fff" : "var(--ink)",
                          border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer", textAlign: "left",
                        }}
                      >
                        <img src={m.avatarUrl} alt="" width={24} height={24} style={{ borderRadius: "50%", flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>{m.displayName}</span>
                        <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>@{m.username}</span>
                        <span style={{ marginLeft: "auto", fontSize: "0.75rem" }}>{on ? t("common.on") : ""}</span>
                      </button>
                    );
                  })}
              </div>
            </>
          ) : null}

          {/* Always available: works with the intent off, and for someone who hasn't
              joined the server yet. */}
          <div style={{ display: "flex", gap: "0.5rem", maxWidth: 420, marginTop: "0.6rem" }}>
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

      {/* ---- audit log ---- */}
      {cfg.authorized && <ActionLog world={world} />}

      {/* ---- what the commands are ---- */}
      {cfg.authorized && (
        <div className="panel" style={panel}>
          <h3 className="heading" style={step}>{t("bot.commandsTitle")}</h3>
          <ul className="subtle" style={{ fontSize: "0.8rem", marginBottom: 0, paddingLeft: "1.1rem" }}>
            <li><code>/start</code> · <code>/stop</code> · <code>/restart</code> — {t("bot.cmdLifecycle")}</li>
            <li><code>/status</code> — {t("bot.cmdStatus")}</li>
            <li><code>/broadcast</code> — {t("bot.cmdBroadcast")}</li>
            <li><code>/backup</code> — {t("bot.cmdBackup")}</li>
            <li><code>/kick</code> — {t("bot.cmdKick")}</li>
          </ul>
          <p className="subtle" style={{ fontSize: "0.75rem", marginTop: "0.7rem", marginBottom: 0 }}>{t("bot.appMustRun")}</p>
        </div>
      )}
    </div>
  );
}
