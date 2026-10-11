"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { answeredCount, job } from "@/lib/kinds";
import { initialsOf, isNewFind } from "@/lib/board";
import type { AppState } from "@/lib/types";
import { BoardIcon, ListIcon, PanelIcon, ShieldIcon } from "./icons";
import { useStore } from "./store";
import { TooltipLayer } from "./Tooltip";
import { ConfirmProvider } from "./Confirm";

export function useCounts(s: AppState) {
  const answered = answeredCount(job, s.profile.answers);
  const m = s.materials;
  const sources = [m.resume?.status === "done", !!m.linkedin.pdf, m.links.length > 0].filter(Boolean).length;
  const newCount = s.finds.filter((f) => isNewFind(f, s.settings.newDays)).length;
  return { answered, sources, newCount };
}

const PAGES = [
  { href: "/finds", label: "Finds", mob: "Finds", Icon: BoardIcon },
  { href: "/profile", label: "Search profile", mob: "Profile", Icon: ListIcon },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const { state, putSettings, error } = useStore();
  const path = usePathname();
  const { answered, sources, newCount } = useCounts(state);
  const closed = state.settings.railClosed;
  const name = state.user.name.trim();
  const initials = initialsOf(name || state.user.email);
  const onSettings = path.startsWith("/settings");
  const meta = (href: string) =>
    href === "/profile" ? (answered < 5 ? `${answered}/5` : sources === 0 ? "Add resume" : "") : "";

  return (
    <ConfirmProvider>
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        className="desk-only"
        style={{
          width: closed ? 68 : 220, flex: "none", background: "#1D1A0F", color: "#fff", display: "flex", flexDirection: "column",
          padding: `22px ${closed ? 10 : 14}px`, position: "sticky", top: 0, height: "100vh", transition: "width .18s ease", overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: `0 ${closed ? 0 : 10}px 26px`, flexDirection: closed ? "column" : "row" }}>
          {!closed && <div className="wordmark" style={{ flex: 1, whiteSpace: "nowrap" }}>Lookout</div>}
          <button
            className="h-rail"
            onClick={() => putSettings({ railClosed: !closed })}
            data-tip={closed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={closed ? "Expand sidebar" : "Collapse sidebar"}
            style={{ width: 28, height: 28, flex: "none", border: 0, borderRadius: 8, background: "transparent", color: "#A89F92", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
          >
            <PanelIcon open={!closed} />
          </button>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {PAGES.map(({ href, label, Icon }) => {
            const active = path.startsWith(href);
            const isBoard = href === "/finds";
            return (
              <Link
                key={href}
                href={href}
                data-tip={closed ? label : undefined}
                aria-label={label}
                style={{
                  display: "flex", alignItems: "center", justifyContent: closed ? "center" : "flex-start", gap: 10, padding: "10px 12px",
                  borderRadius: 10, background: active ? "rgba(255,255,255,.09)" : "transparent", color: active ? "#fff" : "#C9C1B5",
                  fontSize: 14.5, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap",
                }}
              >
                <span style={{ position: "relative", width: 18, height: 18, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {isBoard && closed && newCount > 0 && (
                    <span style={{ position: "absolute", top: -7, right: -10, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 999, background: "#427D33", color: "#fff", fontSize: 10, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px #1D1A0F" }}>
                      {newCount}
                    </span>
                  )}
                  <Icon size={17} />
                </span>
                {!closed && (
                  <>
                    <span style={{ flex: 1 }}>{label}</span>
                    {isBoard && newCount > 0 && (
                      <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, background: "#427D33", color: "#fff", fontSize: 11, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", fontVariantNumeric: "tabular-nums" }}>
                        {newCount}
                      </span>
                    )}
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#A89F92" }}>{meta(href)}</span>
                  </>
                )}
              </Link>
            );
          })}
          {state.user.isAdmin && (
            <Link
              href="/admin"
              data-tip={closed ? "Admin" : undefined}
              aria-label="Admin"
              style={{
                display: "flex", alignItems: "center", justifyContent: closed ? "center" : "flex-start", gap: 10, padding: "10px 12px", marginTop: 14,
                borderRadius: 10, background: path.startsWith("/admin") ? "rgba(255,255,255,.09)" : "transparent", color: path.startsWith("/admin") ? "#fff" : "#C9C1B5",
                fontSize: 14.5, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              <span style={{ width: 18, height: 18, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}><ShieldIcon size={17} /></span>
              {!closed && <span style={{ flex: 1 }}>Admin</span>}
            </Link>
          )}
        </nav>
        <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.1)" }}>
          <Link
            href="/settings"
            className="h-rail"
            data-tip={closed ? `${name || "You"} · Settings` : "Settings"}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: closed ? "center" : "flex-start", gap: 10,
              padding: `8px ${closed ? 0 : 10}px`, borderRadius: 10, background: onSettings ? "rgba(255,255,255,.09)" : "transparent",
              color: "#fff", textDecoration: "none",
            }}
          >
            <Avatar initials={initials} />
            {!closed && (
              <div style={{ minWidth: 0, flex: 1, whiteSpace: "nowrap", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                {name || "Add your name"}
              </div>
            )}
          </Link>
        </div>
      </aside>

      <main className="lk-main" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="mob-only" style={{ position: "relative", zIndex: 8, height: 56, background: "#1D1A0F", color: "#fff", alignItems: "center", gap: 10, padding: "0 12px 0 16px" }}>
          <div className="mob-flex" style={{ display: "flex", alignItems: "center", height: "100%" }}>
            <div className="wordmark" style={{ flex: 1 }}>Lookout</div>
            <Link href="/settings" aria-label="Settings" style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Avatar initials={initials} ring={onSettings} />
            </Link>
          </div>
        </div>
        {children}
      </main>

      <nav
        className="mob-only"
        style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9, background: "#1D1A0F", gridTemplateColumns: "repeat(3,1fr)", padding: "6px 6px calc(6px + env(safe-area-inset-bottom))", borderTop: "1px solid rgba(255,255,255,.08)" }}
      >
        <div className="mob-grid" style={{ display: "grid", gridTemplateColumns: `repeat(${PAGES.length},1fr)` }}>
          {PAGES.map(({ href, mob, Icon }) => {
            const active = path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 52, borderRadius: 10, color: active ? "#F8A865" : "#A89F92", fontSize: 11.5, fontWeight: 600, textDecoration: "none" }}
              >
                <span style={{ position: "relative", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {href === "/finds" && newCount > 0 && (
                    <span style={{ position: "absolute", top: -6, right: -11, minWidth: 17, height: 17, padding: "0 4px", borderRadius: 999, background: "#427D33", color: "#fff", fontSize: 10.5, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px #1D1A0F" }}>
                      {newCount}
                    </span>
                  )}
                  <Icon size={20} />
                </span>
                <span>{mob}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {error && (
        <div role="alert" style={{ position: "fixed", left: "50%", bottom: 92, transform: "translateX(-50%)", zIndex: 60, background: "#1D1A0F", color: "#fff", fontSize: 13.5, fontWeight: 600, padding: "11px 16px", borderRadius: 12, boxShadow: "0 8px 28px rgba(29,26,15,.25)", maxWidth: "calc(100vw - 32px)" }}>
          {error}
        </div>
      )}
      <TooltipLayer />
    </div>
    </ConfirmProvider>
  );
}

export function Avatar({ initials, ring }: { initials: string; ring?: boolean }) {
  return (
    <span
      style={{
        width: 34, height: 34, borderRadius: "50%", background: "#99220F", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 600, flex: "none", boxShadow: ring ? "0 0 0 2px #1D1A0F, 0 0 0 4px #F8A865" : "none",
      }}
    >
      {initials}
    </span>
  );
}
