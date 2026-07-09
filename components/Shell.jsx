"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { Icon, registerToast } from "@/components/ui";
import { useJobsPoll, summarize, ProgressBar } from "@/components/jobsClient";

const NAV = [
  { href: "/", icon: "grid", label: "Worlds", match: (p) => p === "/" || p.startsWith("/worlds") },
  { href: "/settings", icon: "settings", label: "Settings", match: (p) => p.startsWith("/settings") },
  { href: "/info", icon: "info", label: "Info", match: (p) => p.startsWith("/info") },
];

export default function Shell({ children }) {
  const { theme, toggle } = useTheme();
  const path = usePathname();
  const [toasts, setToasts] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [ver, setVer] = useState(null);
  const jobs = useJobsPoll();
  const jobSummary = summarize(jobs);

  useEffect(() => {
    fetch("/api/app/version").then((r) => r.json()).then(setVer).catch(() => {});
  }, []);

  const openRelease = () => {
    const url = ver?.releaseUrl;
    if (url) { try { window.open(url, "_blank"); } catch {} }
  };

  useEffect(() => {
    // restore collapse preference
    try { const v = window.__palSidebar; if (typeof v === "boolean") setCollapsed(v); } catch {}
  }, []);
  const toggleCollapse = () => setCollapsed((c) => { const n = !c; try { window.__palSidebar = n; } catch {} return n; });

  useEffect(() => {
    registerToast((msg, kind) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t, { id, msg, kind }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
    });
  }, []);

  const W = collapsed ? 68 : 236;

  return (
    <div style={{ display: "flex", minHeight: "100vh", height: "100vh", overflow: "hidden" }}>
      {/* Single merged collapsible sidebar */}
      <aside style={{
        width: W, background: "var(--sidebar)", display: "flex", flexDirection: "column",
        flexShrink: 0, borderRight: "1px solid var(--line-strong)",
        transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)", overflow: "hidden",
      }}>
        {/* brand + collapse toggle */}
        <div style={{ height: 56, display: "flex", alignItems: "center", padding: collapsed ? "0" : "0 0.9rem", justifyContent: collapsed ? "center" : "space-between", borderBottom: "1px solid var(--line-strong)", flexShrink: 0 }}>
          {!collapsed && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--accent)", display: "grid", placeItems: "center", color: "#fff", flexShrink: 0 }}>
                <Icon name="globe" size={20} />
              </div>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "0.92rem", whiteSpace: "nowrap" }}>Palworld</span>
            </div>
          )}
          <button onClick={toggleCollapse} title={collapsed ? "Expand" : "Collapse"}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-soft)", padding: 7, borderRadius: 8, display: "grid", placeItems: "center", transition: "background 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--line)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={18} />
          </button>
        </div>

        {/* nav */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0.7rem 0.55rem" }}>
          {!collapsed && (
            <div className="subtle" style={{ fontSize: "0.64rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", padding: "0.3rem 0.6rem 0.5rem" }}>
              Management
            </div>
          )}
          {NAV.map((n) => (
            <NavItem key={n.href} {...n} active={n.match(path)} collapsed={collapsed} />
          ))}
          <DownloadsNavItem active={path.startsWith("/downloads")} collapsed={collapsed} summary={jobSummary} />
        </div>

        {/* footer: app version / update + theme */}
        <div style={{ padding: "0.55rem", borderTop: "1px solid var(--line-strong)", flexShrink: 0 }}>
          {!collapsed && ver?.updateAvailable && (
            <button onClick={openRelease} title="Open the latest release to download"
              style={{
                width: "100%", marginBottom: "0.5rem", padding: "0.45rem 0.6rem", borderRadius: 8,
                background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "0.45rem", fontWeight: 700, fontSize: "0.78rem",
              }}>
              <Icon name="download" size={15} />
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                Update available — v{ver.latest}
              </span>
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", justifyContent: collapsed ? "center" : "space-between" }}>
            {!collapsed && (
              <div style={{ lineHeight: 1.1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                  Palworld Server Manager
                </div>
                <div className="subtle" style={{ fontSize: "0.68rem" }}>
                  v{ver?.current || "—"}{ver && !ver.updateAvailable && ver.checked ? " · up to date" : ""}
                </div>
              </div>
            )}
            {collapsed && ver?.updateAvailable ? (
              <button onClick={openRelease} title={`Update available — v${ver.latest}`}
                style={{ background: "var(--accent)", border: "none", cursor: "pointer", color: "#fff", padding: 7, borderRadius: 8, display: "grid", placeItems: "center" }}>
                <Icon name="download" size={18} />
              </button>
            ) : (
              <button onClick={toggle} title="Toggle theme"
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-soft)", padding: 7, borderRadius: 8, display: "grid", placeItems: "center", transition: "background 0.15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--line)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflowY: "auto", background: "var(--bg)" }}>
        <div style={{ padding: "1.4rem 1.8rem 3rem", maxWidth: 1120, margin: "0 auto" }}>
          {children}
        </div>
      </main>

      {/* Toasts */}
      <div style={{ position: "fixed", right: 18, bottom: 18, display: "flex", flexDirection: "column", gap: 8, zIndex: 50 }}>
        {toasts.map((t) => (
          <div key={t.id} className="panel animate-floatUp" style={{
            padding: "0.7rem 1rem", minWidth: 220, maxWidth: 340, fontWeight: 600, fontSize: "0.88rem",
            borderLeft: `3px solid ${t.kind === "error" ? "var(--red)" : t.kind === "success" ? "var(--green-bright)" : "var(--accent)"}`,
          }}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

function NavItem({ href, icon, label, active, collapsed }) {
  return (
    <Link href={href} title={collapsed ? label : undefined}
      style={{
        display: "flex", alignItems: "center", gap: "0.6rem",
        padding: collapsed ? "0.6rem" : "0.55rem 0.6rem", borderRadius: 8,
        justifyContent: collapsed ? "center" : "flex-start",
        textDecoration: "none", fontFamily: "var(--font-display)",
        fontWeight: 600, fontSize: "0.9rem", marginBottom: 3,
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "var(--ink-soft)",
        transition: "background 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "var(--card-2)"; e.currentTarget.style.color = "var(--ink)"; } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--ink-soft)"; } }}
    >
      <Icon name={icon} size={20} />
      {!collapsed && <span style={{ whiteSpace: "nowrap" }}>{label}</span>}
    </Link>
  );
}

// Sidebar "Downloads" entry — a permanent nav item that shows a live count and
// aggregate progress while installs/updates run, and links to the Downloads page.
function DownloadsNavItem({ active, collapsed, summary }) {
  const { activeCount, percent, anyError } = summary;
  const busy = activeCount > 0;
  const dotColor = anyError ? "var(--red)" : "var(--accent)";

  return (
    <Link href="/downloads" title={collapsed ? `Downloads${busy ? ` (${activeCount})` : ""}` : undefined}
      style={{
        display: "block", padding: collapsed ? "0.6rem" : "0.55rem 0.6rem", borderRadius: 8,
        textDecoration: "none", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.9rem",
        marginBottom: 3, marginTop: 2,
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "var(--ink-soft)",
        transition: "background 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "var(--card-2)"; e.currentTarget.style.color = "var(--ink)"; } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--ink-soft)"; } }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", justifyContent: collapsed ? "center" : "flex-start", position: "relative" }}>
        <span style={{ position: "relative", display: "grid", placeItems: "center" }}>
          <Icon name="download" size={20} />
          {busy && (
            <span className="animate-pulseDot" style={{ position: "absolute", top: -3, right: -4, width: 8, height: 8, borderRadius: 999, background: dotColor, border: "1.5px solid var(--sidebar)" }} />
          )}
        </span>
        {!collapsed && <span style={{ whiteSpace: "nowrap", flex: 1 }}>Downloads</span>}
        {!collapsed && busy && (
          <span className="chip" style={{ background: active ? "rgba(255,255,255,0.2)" : "var(--card-2)", fontSize: "0.7rem", fontWeight: 800, padding: "0.05rem 0.4rem" }}>
            {activeCount}
          </span>
        )}
      </div>
      {!collapsed && busy && (
        <ProgressBar percent={percent} style={{ marginTop: "0.5rem", height: 5 }} />
      )}
    </Link>
  );
}
