"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { inFirstWeek, scheduleLabel } from "@/lib/firstWeek";
import { useStore } from "../store";
import { trackClient } from "../track";
import { color, font } from "@/lib/tokens";

const KEY = "lookout.firstWeekTips";
const readHidden = () => {
  try {
    return localStorage.getItem(KEY) === "hidden";
  } catch {
    return false;
  }
};

/**
 * First-week tips (#992): the few things new people can change but don't find on their own.
 * Shows once setup is done, for the first 7 days, until dismissed on this device.
 */
export function FirstWeek({ ready }: { ready: boolean }) {
  const { state, readOnly } = useStore();
  // Hidden on the server render; the browser reads the dismissal from this device.
  const stored = useSyncExternalStore(() => () => {}, readHidden, () => true);
  const [hidden, setHidden] = useState(false);
  // Folded to one row, so after a first search the finds show without scrolling, also on a phone (#1531).
  const [open, setOpen] = useState(false);
  if (stored || hidden || !ready || readOnly || !inFirstWeek(state.user.joinedAt)) return null;
  const st = state.settings;
  const hide = () => {
    try {
      localStorage.setItem(KEY, "hidden");
    } catch {}
    setHidden(true);
  };
  const tips = [
    {
      id: "frequency",
      title: "How often Lookout searches",
      body: `Now ${scheduleLabel(st)}. You can switch to twice a week or daily, and pick the days.`,
      href: "/settings#discovery",
      cta: "Change in Settings",
    },
    {
      id: "notes",
      title: "Notes teach Lookout",
      body: "Open a find and write what's right or wrong about it. Lookout reads your notes before its next search.",
    },
    {
      id: "not-a-fit",
      title: "Not a fit",
      body: "In a find, press Not a fit and say why. Lookout uses the reason to skip roles like it.",
    },
    {
      id: "email",
      title: "Finds email",
      body: st.digest ? `New finds are emailed to ${state.user.email} after each search.` : "The finds email is off.",
      href: "/settings",
      cta: st.digest ? "Turn off in Settings" : "Turn on in Settings",
    },
  ];
  return (
    <section aria-labelledby="fw-title" className="board-sec lk-in" style={{ background: "#fff", padding: "10px 14px 10px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="fw-tips"
          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, minHeight: 40, border: 0, background: "transparent", padding: 0, cursor: "pointer", textAlign: "left", color: color.ink }}
        >
          <span id="fw-title" style={{ fontSize: font.md, fontWeight: 700 }}>Your first week: {tips.length} things you can change</span>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button onClick={hide} style={{ height: 34, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${color.border}`, background: "#fff", color: color.ink, fontSize: font.base, fontWeight: 600, cursor: "pointer", flex: "none" }}>
          Got it
        </button>
      </div>
      <div id="fw-tips" hidden={!open} style={{ display: open ? "grid" : "none", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16, paddingBottom: 10 }}>
        {tips.map((t) => (
          <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: font.base, fontWeight: 600 }}>{t.title}</div>
            <div style={{ fontSize: font.base, lineHeight: 1.45, color: color.t2, textWrap: "pretty" }}>{t.body}</div>
            {t.href && (
              <Link href={t.href} onClick={() => trackClient("tip_clicked", `first-week:${t.id}`)} style={{ fontSize: font.base, fontWeight: 600, color: color.brick, alignSelf: "flex-start" }}>
                {t.cta}
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
