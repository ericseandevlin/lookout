"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ApplicationStatus, AutoApplySettings } from "@/lib/db/schema";
import { PageHead } from "./Profile";
import { Row, Section, Seg, btn } from "./Settings";
import { useConfirm } from "./Confirm";
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

const STATUS: Record<ApplicationStatus, { label: string; bg: string; ink: string }> = {
  queued: { label: "Queued", bg: "#F4F1EC", ink: "#3B362C" },
  scanning: { label: "Reading the application", bg: "#FDE7D3", ink: "#7A3A10" },
  drafting: { label: "Drafting", bg: "#FDE7D3", ink: "#7A3A10" },
  needs_review: { label: "Ready for your review", bg: "#1D1A0F", ink: "#fff" },
  approved: { label: "Approved", bg: "#E3EFDD", ink: "#35662A" },
  submitting: { label: "Sending", bg: "#E3EFDD", ink: "#35662A" },
  submitted: { label: "Applied", bg: "#35662A", ink: "#fff" },
  manual: { label: "Finish by hand", bg: "#FBEDEA", ink: "#99220F" },
  failed: { label: "Didn't work", bg: "#FBEDEA", ink: "#99220F" },
  canceled: { label: "Canceled", bg: "#EEEAE4", ink: "#5E574D" },
};

const STEPS = [
  ["Reads the application", "Every field, upload, essay and portfolio ask, and which system runs it."],
  ["Drafts everything", "A resume tuned to the posting's keywords, a cover letter, every answer, your portfolio picks, and one or two people worth messaging."],
  ["Shows its work", "Each draft next to the posting, with its sources and what it changed. Anything it doesn't know becomes a question for you."],
  ["You edit and approve", "Edit directly or chat to revise. Every change is saved as a version with a note. You approve the exact versions that go out."],
  ["It applies", "By the company's system, a browser worker, or a two-minute checklist when automation isn't allowed. It records exactly what was sent."],
] as const;

/** /apply: the auto-apply beta. Phase 1 queues applications; reading, drafting, review and sending come next. */
export function ApplyPage() {
  const ask = useConfirm();
  const [settings, setSettings] = useState<AutoApplySettings | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ settings: AutoApplySettings; applications: App[] }>("/api/apply")
      .then((r) => {
        setSettings(r.settings);
        setApps(r.applications);
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
      setApps((xs) => xs.filter((x) => x.id !== a.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't cancel");
    }
  };

  const on = !!settings?.enabled;
  return (
    <div className="page-pad settings lk-page" style={{ display: "flex", flexDirection: "column", maxWidth: 820 }}>
      <PageHead eyebrow="Beta" title="Auto-apply" intro="Lookout prepares each application, shows you everything it wrote, and only sends what you approve." />

      {err && <div role="alert" style={{ fontSize: 14, color: "#99220F", marginTop: 8 }}>{err}</div>}

      {settings && (
        <div style={{ marginTop: 18, padding: 20, borderRadius: 14, background: on ? "#1D1A0F" : "#fff", color: on ? "#fff" : "#1D1A0F", border: on ? 0 : "1.5px solid #E6E0D8", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{on ? "Auto-apply is on" : "Auto-apply is off"}</div>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: on ? "#E9E3DA" : "#6B6358" }}>
              {on
                ? `New matches scoring ${settings.threshold === 5 ? "5" : "4 or 5"} are queued automatically, up to ${settings.dailyCap} a day. Nothing is sent until you approve it.`
                : "Turn it on to queue strong matches automatically. You can still apply to any role from its detail panel."}
            </div>
          </div>
          <button
            role="switch"
            aria-checked={on}
            aria-label="Auto-apply"
            onClick={() => save({ enabled: !on })}
            style={{ flex: "none", width: 64, height: 36, borderRadius: 999, border: 0, padding: 4, background: on ? "#F8A865" : "#D9D2C7", cursor: "pointer", display: "flex", justifyContent: on ? "flex-end" : "flex-start" }}
          >
            <span aria-hidden style={{ width: 28, height: 28, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
          </button>
        </div>
      )}

      {settings && on && (
        <>
          <Row title="Which matches" help="The lowest score Lookout queues on its own.">
            <Seg opts={[["Only 5s", 5], ["4 and up", 4]]} cur={settings.threshold} pick={(v) => save({ threshold: v as 4 | 5 })} />
          </Row>
          <Row title="How many a day" help="A cap on automatic queuing, so review never piles up.">
            <Seg opts={[["1", 1], ["3", 3], ["5", 5]]} cur={settings.dailyCap} pick={(v) => save({ dailyCap: v })} />
          </Row>
        </>
      )}

      <Section>How it works</Section>
      <ol style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {STEPS.map(([title, body], i) => (
          <li key={title} style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr)", gap: 10, alignItems: "start" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#99220F" }}>{i + 1}</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: "#6B6358" }}>{body}</span>
            </span>
          </li>
        ))}
      </ol>
      <p style={{ fontSize: 14, lineHeight: 1.5, color: "#6B6358", margin: "14px 0 0" }}>
        Being built in stages. Today it queues applications. Reading applications, drafting, review and sending are next.
      </p>

      <Section>Applications</Section>
      {apps.length === 0 ? (
        <div style={{ marginTop: 8, padding: 18, borderRadius: 12, background: "#fff", border: "1.5px solid #E6E0D8", fontSize: 14, lineHeight: 1.5 }}>
          Nothing queued yet. Open a role on <Link href="/finds">your board</Link> and choose <b>Apply with Lookout</b>.
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {apps.map((a) => {
            const st = STATUS[a.status];
            return (
              <li key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", borderRadius: 12, background: "#fff", border: "1.5px solid #E6E0D8" }}>
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.role}</div>
                  <div style={{ fontSize: 14, color: "#6B6358" }}>
                    {a.company}
                    {a.score ? ` · match ${a.score}/5` : ""} · {a.queuedBy === "auto" ? "queued automatically" : "you queued it"}
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
      )}
    </div>
  );
}
