"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ApplicationStatus } from "@/lib/db/schema";
import { applicationLabel } from "@/lib/applyLabels";
import { useConfirm } from "./Confirm";
import { api } from "./store";
import { letterHeaderFrom, readable, TEMPLATE_STYLE, type Template } from "@/lib/application/resumeLayout";
import { SubmitModeNote } from "./SubmitModeNote";
import { card, muted, resumeText, type Detail } from "./review/shared";
import { Checklist } from "./review/Checklist";
import { EeoSection } from "./review/EeoSection";
import { ItemCard } from "./review/ItemCard";
import { KeywordReport } from "./review/KeywordReport";
import { PostingText } from "./review/PostingText";
import { QuestionRow } from "./review/QuestionRow";
import { SendForMe } from "./review/SendForMe";

export { DocPreview } from "./review/DocPreview";

const WORKING: ApplicationStatus[] = ["queued", "scanning", "drafting"];
const POLL: ApplicationStatus[] = [...WORKING, "submitting"];
const SECTIONS: { title: string; kinds: string[]; help?: string }[] = [
  { title: "Resume", kinds: ["resume"] },
  { title: "Cover letter", kinds: ["cover_letter"] },
  { title: "People to reach", kinds: ["outreach"], help: "Drafts only. Lookout never sends these. Check the person and public source, then copy the message you want to send yourself." },
  { title: "Questions", kinds: ["answer", "portfolio"] },
  { title: "Basic fields", kinds: ["field"], help: "Filled from your account, resume and saved answers. No approval needed; edit any of them." },
];

/** /apply/[id]: everything Lookout drafted for one application, to edit, revise with AI and approve, then send. */
export function ApplicationReview({ id }: { id: string }) {
  const ask = useConfirm();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [said, setSaid] = useState("");

  const load = useCallback(() => api<Detail>(`/api/apply/${id}`).then(setD).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load")), [id]);
  useEffect(() => {
    load();
  }, [load]);
  const working = !!d && WORKING.includes(d.status);
  const [testing, setTesting] = useState<string | null>(null);
  const polling = (!!d && POLL.includes(d.status)) || (!!testing && (d?.report.fill?.at ?? "none") === testing);
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [polling, load]);

  const fill = async (mode: "test" | "submit") => {
    if (mode === "submit") {
      const ok = await ask({
        eyebrow: "Submit for me",
        title: `Send your application to ${d?.company}?`,
        body: "Lookout fills the form with the exact versions you approved and clicks Submit. If anything looks off (a captcha, a field it can't fill), it stops and you finish with the checklist.",
        confirmLabel: "Send it",
      });
      if (!ok) return;
    }
    setErr(null);
    try {
      setTesting(d?.report.fill?.at ?? "none");
      await api(`/api/apply/${id}/fill`, { method: "POST", json: { mode } });
      setSaid(mode === "test" ? "Filling the form in a test run. Nothing gets submitted. Takes about a minute." : "Sending. Takes about a minute.");
      await load();
    } catch (e) {
      setTesting(null);
      setErr(e instanceof Error ? e.message : "Couldn't start");
    }
  };

  const act = async (itemId: string, payload: Record<string, unknown>, done: string) => {
    setErr(null);
    try {
      const r = await api<{ status: ApplicationStatus; question?: string | null }>(`/api/apply/${id}/items/${itemId}`, { method: "POST", json: payload });
      await load();
      setSaid(r.question ? `Lookout asks: ${r.question}` : done);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
      return false;
    }
  };

  const pickTemplate = async (template: Template) => {
    setD((x) => (x ? { ...x, template } : x));
    try {
      await api("/api/apply", { method: "PATCH", json: { template } });
      setSaid(`${TEMPLATE_STYLE[template].label} design. Your resume and cover letter use it, here and in the files Lookout uploads.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    }
  };

  const pickAccent = async (hex: string) => {
    const accent = readable(hex);
    setD((x) => (x ? { ...x, accent } : x));
    try {
      await api("/api/apply", { method: "PATCH", json: { accent } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    }
  };

  const submitted = async () => {
    const ok = await ask({ eyebrow: "Mark as applied", title: `Did you submit the application to ${d?.company}?`, body: "Lookout records exactly what you approved and moves the role to Applied on your board.", confirmLabel: "Yes, I applied" });
    if (!ok) return;
    try {
      await api(`/api/apply/${id}/submitted`, { method: "POST" });
      await load();
      setSaid("Recorded. The role is now Applied on your board.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    }
  };

  if (!d) return <div className="page-pad lk-page" style={muted}>{err ?? "Loading…"}</div>;

  const st = applicationLabel(d.status, "user");
  const required = d.items.filter((i) => i.required);
  const approved = required.filter((i) => i.approvedVersionId).length;
  const open = d.items.filter((i) => i.question);
  const locked = d.status === "submitted";

  return (
    <div className="page-pad lk-page" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1180 }}>
      <style>{`.lk-review{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}@media(min-width:1000px){.lk-review{grid-template-columns:minmax(0,1fr) 360px}.lk-review aside{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto}}`}</style>
      <Link href="/apply" style={{ fontSize: 14, color: "#1D1A0F" }}>← All applications</Link>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>{d.role}</h1>
          <div style={{ ...muted, marginTop: 4 }}>
            {d.company}
            {d.ats ? ` · ${d.ats === "other" ? "company site" : d.ats}` : ""}
            {d.report.usd ? ` · AI cost $${d.report.usd.toFixed(3)}` : ""}
          </div>
        </div>
        <span style={{ padding: "6px 12px", borderRadius: 999, fontSize: 14, fontWeight: 600, background: st.bg, color: st.ink }}>{st.label}</span>
      </div>

      <div aria-live="polite" style={{ ...muted, minHeight: 20 }}>{said}</div>
      {err && <div role="alert" style={{ fontSize: 14, color: "#99220F" }}>{err}</div>}

      {working && <div style={card}>Lookout is {d.status === "drafting" ? "drafting your application" : "reading the application"}. This takes a minute or two; the page updates on its own.</div>}
      {d.status === "failed" && <div role="alert" style={{ ...card, borderColor: "#E8B4AA", color: "#99220F" }}>{d.report.error ?? "This one didn't work."} Go back to the list to try again.</div>}

      {!working && d.items.length > 0 && (
        <div className="lk-review">
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {!locked && (
              <div style={{ ...card, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>
                    {approved} of {required.length} required items approved
                  </div>
                  <div style={muted}>{d.status === "manual" ? "Ready. Use the checklist at the bottom to send it." : d.status === "approved" ? "Ready. Lookout can send it for you, or use the checklist." : "Approve the exact version of each one you want sent. Editing makes a new version."}</div>
                </div>
                <div style={{ flexBasis: "100%" }}>
                  <SubmitModeNote submit={d.submit} />
                </div>
              </div>
            )}

            {open.length > 0 && !locked && (
              <section aria-labelledby="qs" style={{ ...card, borderColor: "#F8A865", background: "#FFF9F3" }}>
                <h2 id="qs" style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700 }}>Lookout needs you for {open.length === 1 ? "one thing" : `${open.length} things`}</h2>
                <p style={{ ...muted, margin: "0 0 12px" }}>It won&apos;t guess facts. Answer here and it becomes a version you can approve.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {open.map((i) => (
                    <QuestionRow key={i.id} item={i} onSave={(content) => act(i.id, { action: "edit", content, note: "Answered by you." }, "Saved. Common answers like this one are kept on your profile for next time.")} />
                  ))}
                </div>
              </section>
            )}

            {!!d.report.traps?.length && !locked && (
              <section aria-labelledby="traps" style={{ ...card, borderColor: "#E8B4AA", background: "#FFF6F4" }}>
                <h2 id="traps" style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700 }}>This posting tries to catch automated applications</h2>
                <p style={{ ...muted, margin: "0 0 10px" }}>
                  Lookout found {d.report.traps.length === 1 ? "an instruction" : `${d.report.traps.length} instructions`} planted for applicants or AI tools and did not follow {d.report.traps.length === 1 ? "it" : "them"}. Hidden ones are invisible to people, so following them gives you away. Visible ones may be an attention check for careful readers; if you want to follow one, add it yourself.
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
                  {d.report.traps.map((t, i) => (
                    <li key={i}>
                      <span style={{ fontWeight: 600 }}>{t.hidden ? "Hidden from readers: " : "Visible: "}</span>“{t.text}”
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {d.items.some((i) => i.kind === "eeo") && !locked && <EeoSection d={d} act={act} />}

            {SECTIONS.map((s) => {
              const list = d.items.filter((i) => s.kinds.includes(i.kind));
              if (!list.length) return null;
              return (
                <section key={s.title} aria-labelledby={`sec-${s.title}`} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <h2 id={`sec-${s.title}`} style={{ margin: "6px 0 0", fontSize: 18, fontWeight: 700 }}>{s.title}</h2>
                  {s.help && !locked && <div style={{ ...muted, marginTop: -4 }}>{s.help}</div>}
                  {s.title === "Resume" && d.keywordRows && <KeywordReport d={d} rows={d.keywordRows} reload={load} locked={locked} />}
                  {list.map((i) => (
                    <ItemCard key={i.id} appId={d.id} item={i} locked={locked} act={act} analysis={d.report.recruiter?.[i.id]} template={d.template} accent={d.accent} header={i.kind === "cover_letter" ? letterHeaderFrom(resumeText(d), "") : null} onTemplate={pickTemplate} onAccent={pickAccent} />
                  ))}
                </section>
              );
            })}

            {(d.status === "approved" || d.status === "submitting" || d.report.fill) && d.autoSubmit && <SendForMe d={d} busy={polling} onFill={fill} />}
            {(d.status === "manual" || d.status === "approved" || locked) && <Checklist d={d} onDone={submitted} />}
          </div>

          <aside aria-label="The posting" style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>The posting</h2>
            {d.url && (
              <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: "#1D1A0F" }}>
                Open the original ↗
              </a>
            )}
            {d.posting ? <PostingText text={d.posting} /> : <div style={muted}>No description saved for this role.</div>}
          </aside>
        </div>
      )}
    </div>
  );
}
