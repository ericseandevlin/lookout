"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ApplicationStatus, AutoApplySettings } from "@/lib/db/schema";
import { applicationLabel } from "@/lib/applyLabels";
import { PageHead } from "./Profile";
import { Seg, btn } from "./Settings";
import { useConfirm } from "./Confirm";
import { XIcon } from "./icons";
import { api } from "./store";

type App = {
  id: string;
  findId: string;
  company: string;
  role: string;
  url: string | null;
  score: number | null;
  status: ApplicationStatus;
  queuedBy: "user" | "auto";
  ats: string | null;
  createdAt: string;
  submittedAt: string | null;
};

const STEPS = [
  ["Reads the application", "Every field, upload, essay and portfolio ask, and which system runs it."],
  ["Drafts everything", "A resume tuned to the posting's keywords, a cover letter, every answer, your portfolio picks, and one or two people worth messaging."],
  ["Shows its work", "Each draft next to the posting, with its sources and what it changed. Anything it doesn't know becomes a question for you."],
  ["You edit and approve", "Edit directly or chat to revise. Every change is saved as a version with a note. You approve the exact versions that go out."],
  ["It applies", "By the company's system, a browser worker, or a two-minute checklist when automation isn't allowed. It records exactly what was sent."],
] as const;

const GROUPS: { title: string; help: string; statuses: ApplicationStatus[] }[] = [
  { title: "Needs you", help: "Drafts waiting for your review, and anything to finish by hand.", statuses: ["needs_review", "manual", "failed"] },
  { title: "In progress", help: "Lookout is working on these.", statuses: ["queued", "scanning", "drafting", "approved", "submitting"] },
  { title: "Applied", help: "Sent, with a record of exactly what went out.", statuses: ["submitted"] },
];

/**
 * /apply: the auto-apply beta. The queue is the page; the switch sits in a slim bar that never changes
 * size, and settings plus "How it works" live in a side panel so they stay out of the way.
 */
export function ApplyPage() {
  const ask = useConfirm();
  const [settings, setSettings] = useState<AutoApplySettings | null>(null);
  const [apps, setApps] = useState<App[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    api<{ settings: AutoApplySettings; applications: App[] }>("/api/apply")
      .then((r) => {
        setSettings(r.settings);
        setApps(r.applications);
        // Arriving from a find's "View application" link: scroll to it and highlight it briefly.
        const id = window.location.hash.replace(/^#app-/, "");
        if (id && r.applications.some((a) => a.id === id)) {
          setFocusId(id);
          requestAnimationFrame(() => document.getElementById(`app-${id}`)?.scrollIntoView({ block: "center" }));
          setTimeout(() => setFocusId(null), 2400);
        }
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
  }, []);

  const save = async (patch: Partial<AutoApplySettings>) => {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    try {
      const r = await api<{ settings: AutoApplySettings }>("/api/apply", { method: "PATCH", json: patch });
      setSettings(r.settings);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  const cancel = async (a: App) => {
    const ok = await ask({ eyebrow: "Cancel application", title: `Stop applying to ${a.company}?`, body: "Its drafts and versions are deleted. The role stays on your board.", confirmLabel: "Cancel application", danger: true });
    if (!ok) return;
    try {
      await api(`/api/apply/${a.id}`, { method: "DELETE" });
      setApps((xs) => (xs ?? []).filter((x) => x.id !== a.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't cancel");
    }
  };

  const on = !!settings?.enabled;
  const summary = !settings ? "" : on ? `Queues ${settings.threshold === 5 ? "5s" : "4s and 5s"} automatically, up to ${settings.dailyCap} a day` : "Only roles you queue yourself";

  return (
    <div className="page-pad lk-page" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820 }}>
      <PageHead eyebrow="Beta" title="Auto-apply" intro="Lookout drafts each application for your review and only sends what you approve." />

      {settings && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 64, padding: "10px 12px 10px 18px", borderRadius: 14, background: "#fff", border: "1.5px solid #E6E0D8" }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", flex: "none", background: on ? "#427D33" : "#CFC6B9" }} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Auto-apply {on ? "on" : "off"}</span>
            <span style={{ fontSize: 14, color: "#6B6358", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
          </div>
          <button onClick={() => setPanel(true)} style={{ ...btn("outline"), height: 38, flex: "none" }}>Settings</button>
          <Switch on={on} onToggle={() => save({ enabled: !on })} />
        </div>
      )}

      {err && <div role="alert" style={{ fontSize: 14, color: "#99220F" }}>{err}</div>}
      {!apps && !err && <div style={{ fontSize: 14, color: "#6B6358" }}>Loading…</div>}

      {apps && apps.length === 0 && (
        <div style={{ padding: 22, borderRadius: 14, background: "#fff", border: "1.5px solid #E6E0D8", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Nothing queued yet</div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#3B362C" }}>
            Open a role on <Link href="/finds">your board</Link> and choose <b>Apply with Lookout</b>, or turn auto-apply on to queue strong matches as they come in. Lookout reads the application, drafts everything, and waits for your approval before anything is sent.
          </p>
          <button onClick={() => setPanel(true)} style={{ ...btn("text"), alignSelf: "flex-start", height: 32, padding: 0 }}>How it works</button>
        </div>
      )}

      {apps &&
        GROUPS.map((g) => {
          const list = apps.filter((a) => g.statuses.includes(a.status));
          if (!list.length) return null;
          return (
            <section key={g.title} aria-labelledby={`grp-${g.title}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
                <h2 id={`grp-${g.title}`} style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  {g.title} <span style={{ color: "#6B6358", fontWeight: 600 }}>{list.length}</span>
                </h2>
                <span style={{ fontSize: 14, color: "#6B6358" }}>{g.help}</span>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {list.map((a) => {
                  const st = applicationLabel(a.status, a.queuedBy);
                  return (
                    <li
                      key={a.id}
                      id={`app-${a.id}`}
                      style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", borderRadius: 12, background: focusId === a.id ? "#FDF3E8" : "#fff", border: `1.5px solid ${focusId === a.id ? "#F8A865" : "#E6E0D8"}`, transition: "background-color .4s ease, border-color .4s ease", scrollMarginTop: 120 }}
                    >
                      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.role}</div>
                        <div style={{ fontSize: 14, color: "#6B6358" }}>
                          {a.company}
                          {a.score ? ` · match ${a.score}/5` : ""}
                        </div>
                      </div>
                      <span style={{ padding: "5px 11px", borderRadius: 999, fontSize: 14, fontWeight: 600, background: st.bg, color: st.ink }}>{st.label}</span>
                      {a.status !== "submitted" && a.status !== "submitting" && (
                        <button onClick={() => cancel(a)} style={{ ...btn("text"), height: 34, fontSize: 14 }}>Cancel</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

      {apps && apps.length > 0 && (
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6B6358" }}>
          Being built in stages: today it queues. Reading applications, drafting, review and sending are next.{" "}
          <button onClick={() => setPanel(true)} style={{ ...btn("text"), height: "auto", padding: 0, fontSize: 14 }}>How it works</button>
        </p>
      )}

      {panel && settings && <SettingsPanel settings={settings} save={save} close={() => setPanel(false)} />}
    </div>
  );
}

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label="Auto-apply"
      onClick={onToggle}
      style={{ flex: "none", width: 56, height: 32, borderRadius: 999, border: 0, padding: 3, background: on ? "#427D33" : "#CFC6B9", cursor: "pointer", display: "flex", justifyContent: on ? "flex-end" : "flex-start" }}
    >
      <span aria-hidden style={{ width: 26, height: 26, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
    </button>
  );
}

/** Side panel: the switch, its two settings, and how the whole flow works. */
function SettingsPanel({ settings, save, close }: { settings: AutoApplySettings; save: (p: Partial<AutoApplySettings>) => void; close: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  const on = settings.enabled;
  return (
    <>
      <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(29,26,15,.35)" }} />
      <aside role="dialog" aria-modal="true" aria-labelledby="aa-panel-title" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41, width: "min(440px, 100vw)", background: "#fff", boxShadow: "-12px 0 40px rgba(29,26,15,.18)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 22px", borderBottom: "1px solid #EEEAE4" }}>
          <h2 id="aa-panel-title" style={{ margin: 0, flex: 1, fontSize: 20, fontWeight: 700 }}>Auto-apply settings</h2>
          <button ref={closeRef} onClick={close} aria-label="Close" style={{ width: 36, height: 36, borderRadius: "50%", border: 0, background: "#F4F1EC", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <XIcon />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px 28px", display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Queue strong matches automatically</div>
              <div style={{ fontSize: 14, lineHeight: 1.5, color: "#6B6358" }}>You can always queue any role yourself from its detail panel. Nothing is sent until you approve it.</div>
            </div>
            <Switch on={on} onToggle={() => save({ enabled: !on })} />
          </div>
          <fieldset disabled={!on} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 18, opacity: on ? 1 : 0.5 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Which matches</div>
              <Seg opts={[["Only 5s", 5], ["4 and up", 4]]} cur={settings.threshold} pick={(v) => save({ threshold: v as 4 | 5 })} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>How many a day</div>
              <Seg opts={[["1", 1], ["3", 3], ["5", 5]]} cur={settings.dailyCap} pick={(v) => save({ dailyCap: v })} />
              <div style={{ fontSize: 14, color: "#6B6358" }}>A cap so review never piles up.</div>
            </div>
          </fieldset>
          <div style={{ borderTop: "1px solid #EEEAE4", paddingTop: 18 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>How it works</h3>
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {STEPS.map(([title, body], i) => (
                <li key={title} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr)", gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#99220F" }}>{i + 1}</span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
                    <span style={{ fontSize: 14, lineHeight: 1.5, color: "#6B6358" }}>{body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </aside>
    </>
  );
}
