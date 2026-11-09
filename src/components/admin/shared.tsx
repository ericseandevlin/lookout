"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { color } from "@/lib/tokens";

/** Shared by the admin pages: response types, small formatters and styles, the tab bar and the message line. */
export type Overview = {
  inbox: { id: string; from: string; subject: string; receivedAt: string; status: string; triage: { kind: string; summary: string; draftReply?: string | null } | null }[];
  requests: { email: string; nextMove: string | null; createdAt: string }[];
  totals: { users: number; usdDay: number; usdWeek: number; usdMonth: number };
  emailEnabled: boolean;
  users: {
    id: string; email: string; name: string; isAdmin: boolean; disabled: boolean; createdAt: string;
    lastLoginAt: string | null; finds: number; runs30: number; usd30: number; lastRunAt: string | null;
  }[];
  invites: { email: string; createdAt: string; accepted: boolean }[];
  runs: {
    id: string; email: string; trigger: string; status: string; startedAt: string; finishedAt: string | null;
    found: number; added: number; searches: number; costUsd: number; error: string | null;
  }[];
};

export type Config = {
  agent: { tokenSet: boolean; lastSeen: string | null };
  ai: { provider: "openai" | "anthropic" | "agent"; baseUrl: string; model: string; apiKey: string; apiKeyHint: string; apiKeyUnreadable?: boolean; priceIn: number; priceOut: number; jsonMode: "schema" | "object"; privacy: "strict" | "standard" };
  search: { provider: "searxng" | "brave" | "none"; searxngUrl: string; braveKey: string; braveKeyHint: string; braveKeyUnreadable?: boolean; pricePerQuery: number };
  access: { signupMode: "open" | "invite"; dailyBudgetUsd: number; userDailyBudgetUsd: number };
};

export const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
export const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never";
export const input: React.CSSProperties = { width: "100%", maxWidth: 420, height: 42, border: `1.5px solid ${color.border}`, background: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 14, outline: "none", color: color.ink };
export const card: React.CSSProperties = { background: "#fff", borderRadius: 16, padding: "16px 18px" };
export const th: React.CSSProperties = { fontSize: 14, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: color.t2, textAlign: "left", padding: "12px 14px", borderBottom: `1px solid ${color.border}`, whiteSpace: "nowrap" };
export const td: React.CSSProperties = { fontSize: 14, padding: "12px 14px", borderBottom: `1px solid ${color.surface}`, verticalAlign: "top" };

export function Tabs() {
  const path = usePathname();
  const tabs = [["/admin", "People"], ["/admin/ai", "AI settings"], ["/admin/surveys", "Surveys"], ["/admin/quality", "Finds quality"], ["/admin/activity", "Activity"], ["/admin/metrics", "Metrics"], ["/admin/errors", "Errors"]] as const;
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
      {tabs.map(([href, label]) => {
        const on = path === href;
        return (
          <Link key={href} href={href} style={{ display: "flex", alignItems: "center", height: 34, padding: "0 15px", borderRadius: 999, border: `1.5px solid ${on ? color.brick : color.border}`, background: on ? color.brick : "#fff", color: on ? "#fff" : color.ink, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}

export function Msg({ text, ok }: { text: string | null; ok?: boolean }) {
  if (!text) return null;
  return <div aria-live="polite" style={{ fontSize: 14, color: ok ? color.greenText : color.brick, lineHeight: 1.45 }}>{text}</div>;
}
