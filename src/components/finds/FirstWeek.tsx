"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { inFirstWeek, scheduleLabel } from "@/lib/firstWeek";
import { useStore } from "../store";
import { trackClient } from "../track";
import { color } from "@/lib/tokens";

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
    <section aria-labelledby="fw-title" className="board-sec lk-in" style={{ background: "#fff", padding: "18px 22px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: color.brick }}>Your first week</div>
          <div id="fw-title" style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>Things you can change</div>
        </div>
        <button onClick={hide} style={{ height: 34, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${color.border}`, background: "#fff", color: color.ink, fontSize: 14, fontWeight: 600, cursor: "pointer", flex: "none" }}>
          Got it
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
        {tips.map((t) => (
          <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t.title}</div>
            <div style={{ fontSize: 14, lineHeight: 1.45, color: color.t2, textWrap: "pretty" }}>{t.body}</div>
            {t.href && (
              <Link href={t.href} onClick={() => trackClient("tip_clicked", `first-week:${t.id}`)} style={{ fontSize: 14, fontWeight: 600, color: color.brick, alignSelf: "flex-start" }}>
                {t.cta}
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
