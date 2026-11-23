"use client";

import Link from "next/link";
import { useStore } from "./store";
import { trackClient } from "./track";
import { color, font } from "@/lib/tokens";

/**
 * The Auto-apply page's way into the interview (#1449): the answers back up what drafts say. A temporary
 * announcement, so it sits on the page color, not in a content card (#1664). Shows while the interview
 * has a question; once closed, it stays closed for that person.
 */
export function InterviewBanner() {
  const { state, readOnly, putSettings } = useStore();
  if (!state.user.interview || !state.user.interviewOpen || state.settings.interviewBannerClosed || readOnly) return null;
  return (
    <section aria-label="Interview" className="lk-in" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px 10px 18px", borderRadius: 12, background: color.surface, border: `1px solid ${color.border}` }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: font.md, fontWeight: 600 }}>A few quick questions make your drafts stronger.</div>
      <Link
        href="/interview"
        onClick={() => trackClient("tip_clicked", "interview-banner")}
        style={{ height: 36, padding: "0 14px", borderRadius: 10, background: color.brick, color: "#fff", fontSize: font.base, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", flex: "none" }}
      >
        Start
      </Link>
      <button
        onClick={() => putSettings({ interviewBannerClosed: true })}
        aria-label="Close"
        data-tip="Close"
        className="h-soft"
        style={{ width: 44, height: 44, flex: "none", border: 0, borderRadius: 999, background: "transparent", color: color.t2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </section>
  );
}
