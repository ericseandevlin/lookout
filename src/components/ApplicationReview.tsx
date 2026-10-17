"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ApplicationReport, ApplicationStatus } from "@/lib/db/schema";
import { applicationLabel } from "@/lib/applyLabels";
import { btn } from "./Settings";
import { useConfirm } from "./Confirm";
import { api } from "./store";
import { parseDraft, toPlain as toPlainText } from "@/lib/application/resumeLayout";

type Version = { id: string; version: number; content: string; note: string; author: "user" | "ai"; sources: string[]; createdAt: string };
type Item = {
  id: string;
  kind: string;
  prompt: string;
  required: boolean;
  fieldType: string | null;
  options: string[] | null;
  question: string | null;
  approvedVersionId: string | null;
  versions: Version[];
};
type Detail = {
  id: string;
  findId: string;
  status: ApplicationStatus;
  ats: string | null;
  route: string | null;
  report: ApplicationReport;
  submittedAt: string | null;
  confirmation: { sent?: { prompt: string; version: number; content: string }[] } | null;
  company: string;
  role: string;
  url: string | null;
  posting: string;
  autoSubmit: boolean;
  items: Item[];
};

const WORKING: ApplicationStatus[] = ["queued", "scanning", "drafting"];
const POLL: ApplicationStatus[] = [...WORKING, "submitting"];
const SECTIONS: { title: string; kinds: string[]; help?: string }[] = [
  { title: "Resume", kinds: ["resume"] },
  { title: "Cover letter", kinds: ["cover_letter"] },
  { title: "Questions", kinds: ["answer", "portfolio", "outreach"] },
  { title: "Basic fields", kinds: ["field"], help: "Filled from your account, resume and saved answers. No approval needed; edit any of them." },
];
const card: React.CSSProperties = { padding: 18, borderRadius: 14, background: "#fff", border: "1.5px solid #E6E0D8" };
const muted: React.CSSProperties = { fontSize: 14, color: "#6B6358" };

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
            {d.report.hasEeo && !locked && <div style={{ ...card, ...muted }}>This form also has voluntary EEO questions (gender, race, veteran and disability status). Lookout never answers those. Fill them in yourself when you submit, or skip them.</div>}

            {SECTIONS.map((s) => {
              const list = d.items.filter((i) => s.kinds.includes(i.kind));
              if (!list.length) return null;
              return (
                <section key={s.title} aria-labelledby={`sec-${s.title}`} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <h2 id={`sec-${s.title}`} style={{ margin: "6px 0 0", fontSize: 18, fontWeight: 700 }}>{s.title}</h2>
                  {s.help && !locked && <div style={{ ...muted, marginTop: -4 }}>{s.help}</div>}
                  {s.title === "Resume" && d.report.keywords && <KeywordReport k={d.report.keywords} />}
                  {list.map((i) => (
                    <ItemCard key={i.id} appId={d.id} item={i} locked={locked} act={act} />
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
            <div style={{ fontSize: 14, lineHeight: 1.55, color: "#3B362C", whiteSpace: "pre-wrap" }}>{d.posting || "No description saved for this role."}</div>
          </aside>
        </div>
      )}
    </div>
  );
}

/** The resume or letter as the recruiter sees it: same layout as the .docx Lookout uploads. */
function DocPreview({ md }: { md: string }) {
  const blocks = parseDraft(md);
  return (
    <div style={{ background: "#fff", border: "1px solid #E0D9CF", borderRadius: 6, boxShadow: "0 2px 10px rgba(29,26,15,.08)", padding: "36px 44px", fontFamily: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif", color: "#1F1F1F", fontSize: 13.5, lineHeight: 1.45, maxHeight: 640, overflow: "auto" }}>
      {blocks.map((b, i) =>
        b.t === "name" ? (
          <div key={i} style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>{b.text}</div>
        ) : b.t === "contact" ? (
          <div key={i} style={{ fontSize: 12.5, color: "#555" }}>{b.text}</div>
        ) : b.t === "section" ? (
          <div key={i} style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", borderBottom: "1px solid #999", padding: "0 0 2px", margin: "16px 0 6px" }}>{b.text}</div>
        ) : b.t === "role" ? (
          <div key={i} style={{ display: "flex", gap: 12, justifyContent: "space-between", fontWeight: 700, margin: "10px 0 2px" }}>
            <span>{b.text}</span>
            {b.right && <span style={{ fontWeight: 400, color: "#555", whiteSpace: "nowrap" }}>{b.right}</span>}
          </div>
        ) : b.t === "bullet" ? (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "14px 1fr", margin: "1px 0" }}>
            <span aria-hidden>•</span>
            <span>{b.text}</span>
          </div>
        ) : (
          <p key={i} style={{ margin: "0 0 8px" }}>{b.text}</p>
        ),
      )}
    </div>
  );
}

function KeywordReport({ k }: { k: NonNullable<ApplicationReport["keywords"]> }) {
  const before = k.filter((x) => x.before).length;
  const after = k.filter((x) => x.after).length;
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>
        Keyword match {before}/{k.length} → {after}/{k.length}
      </div>
      <div style={muted}>Terms from the posting that applicant tracking systems screen for. Green: in the draft. Struck through: not in your experience, so Lookout left it out.</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {k.map((x) => (
          <li
            key={x.term}
            title={x.where ? `Added in ${x.where}` : x.before ? "Already in your resume" : "Not added"}
            style={{ padding: "4px 10px", borderRadius: 999, fontSize: 14, background: x.after ? "#E3EFDD" : "#F4F1EC", color: x.after ? "#35662A" : "#6B6358", textDecoration: x.after ? "none" : "line-through" }}
          >
            {x.term}
            {x.after && !x.before ? " +" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuestionRow({ item, onSave }: { item: Item; onSave: (content: string) => Promise<boolean> }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    if (await onSave(v)) setV("");
    setBusy(false);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={`q-${item.id}`} style={{ fontSize: 15, fontWeight: 600 }}>
        {item.question}
      </label>
      <div style={muted}>For: {item.prompt}</div>
      {item.options?.length ? (
        <select id={`q-${item.id}`} value={v} onChange={(e) => setV(e.target.value)} style={{ height: 40, borderRadius: 10, border: "1.5px solid #E0D9CF", padding: "0 10px", fontSize: 15, maxWidth: 420 }}>
          <option value="">Choose…</option>
          {item.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <textarea id={`q-${item.id}`} value={v} onChange={(e) => setV(e.target.value)} rows={2} style={{ borderRadius: 10, border: "1.5px solid #E0D9CF", padding: 10, fontSize: 15, fontFamily: "inherit", resize: "vertical" }} />
      )}
      <button onClick={save} disabled={!v.trim() || busy} style={{ ...btn("outline"), alignSelf: "flex-start" }}>
        {busy ? "Saving…" : "Save answer"}
      </button>
    </div>
  );
}

type Act = (itemId: string, payload: Record<string, unknown>, done: string) => Promise<boolean>;

function ItemCard({ appId, item, locked, act }: { appId: string; item: Item; locked: boolean; act: Act }) {
  const latest = item.versions[0];
  const [pick, setPick] = useState<string | null>(null);
  const shown = item.versions.find((v) => v.id === pick) ?? item.versions.find((v) => v.id === item.approvedVersionId) ?? latest;
  const [text, setText] = useState(shown?.content ?? "");
  const [instr, setInstr] = useState("");
  const [busy, setBusy] = useState<null | "save" | "revise" | "approve">(null);
  // Reset the editor when the shown version changes (a pick, or a new version from the server).
  const key = `${shown?.id}:${shown?.content}`;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setText(shown?.content ?? "");
  }

  const isApproved = !!shown && shown.id === item.approvedVersionId;
  const dirty = text !== (shown?.content ?? "");
  const doc = item.kind === "resume" || item.kind === "cover_letter";
  const [editing, setEditing] = useState(false);
  const long = doc || (item.fieldType === "textarea" && item.kind !== "field");
  const run = async (kind: NonNullable<typeof busy>, payload: Record<string, unknown>, done: string) => {
    setBusy(kind);
    const ok = await act(item.id, payload, done);
    if (ok && kind !== "approve") setPick(null);
    if (ok && kind === "revise") setInstr("");
    setBusy(null);
  };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, borderColor: isApproved ? "#9CC68E" : "#E6E0D8" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <label htmlFor={`it-${item.id}`} style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600 }}>
          {item.prompt}
          {item.required ? <span style={{ color: "#99220F" }}> *</span> : <span style={{ ...muted, fontWeight: 400 }}> (optional)</span>}
        </label>
        {isApproved && <span style={{ fontSize: 14, fontWeight: 600, color: "#35662A" }}>{item.kind === "field" ? "✓ Will be filled" : `✓ Approved v${shown.version}`}</span>}
      </div>

      {doc && !editing ? (
        <DocPreview md={text} />
      ) : item.options?.length && !locked ? (
        <select id={`it-${item.id}`} value={text} onChange={(e) => setText(e.target.value)} style={{ height: 40, borderRadius: 10, border: "1.5px solid #E0D9CF", padding: "0 10px", fontSize: 15, maxWidth: 420 }}>
          <option value="">Choose…</option>
          {item.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <textarea
          id={`it-${item.id}`}
          value={text}
          readOnly={locked}
          onChange={(e) => setText(e.target.value)}
          rows={long ? (item.kind === "resume" ? 18 : 8) : 1}
          style={{ borderRadius: 10, border: "1.5px solid #E0D9CF", padding: 10, fontSize: 15, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical", background: locked ? "#FAF8F5" : "#fff" }}
        />
      )}

      {shown && (
        <div style={{ ...muted, display: "flex", flexDirection: "column", gap: 2 }}>
          <span>
            v{shown.version} by {shown.author === "ai" ? "Lookout" : "you"}: {shown.note}
          </span>
          {shown.sources.length > 0 && <span>Sources: {shown.sources.join(" · ")}</span>}
        </div>
      )}

      {!locked && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {doc && (
              <button onClick={() => setEditing((e) => !e)} aria-pressed={editing} style={btn("outline")}>
                {editing ? "Preview" : "Edit text"}
              </button>
            )}
            {doc && !dirty && (
              <a href={`/api/apply/${appId}/items/${item.id}/docx`} style={{ ...btn("text"), display: "inline-flex", alignItems: "center" }}>
                Download .docx
              </a>
            )}
            {item.versions.length > 1 && (
              <select aria-label="Version" value={shown?.id} onChange={(e) => setPick(e.target.value)} style={{ height: 38, borderRadius: 10, border: "1.5px solid #E0D9CF", padding: "0 8px", fontSize: 14 }}>
                {item.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version} · {v.author === "ai" ? "Lookout" : "you"}
                    {v.id === item.approvedVersionId ? " · approved" : ""}
                  </option>
                ))}
              </select>
            )}
            {dirty ? (
              <button onClick={() => run("save", { action: "edit", content: text, note: "" }, "Saved as a new version.")} disabled={!!busy} style={btn("outline")}>
                {busy === "save" ? "Saving…" : "Save as new version"}
              </button>
            ) : item.kind === "field" ? null : isApproved ? (
              <button onClick={() => run("approve", { action: "approve", versionId: null }, "Approval removed.")} disabled={!!busy} style={btn("text")}>
                Unapprove
              </button>
            ) : (
              <button onClick={() => shown && run("approve", { action: "approve", versionId: shown.id }, `Approved v${shown.version}.`)} disabled={!!busy || !shown?.content.trim()} style={btn("solid")}>
                {busy === "approve" ? "Approving…" : `Approve v${shown?.version ?? 1}`}
              </button>
            )}
          </div>
          {item.kind !== "field" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (instr.trim()) run("revise", { action: "revise", instruction: instr }, "Lookout made a new version.");
              }}
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <label htmlFor={`rv-${item.id}`} className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                Ask Lookout to revise {item.prompt}
              </label>
              <input
                id={`rv-${item.id}`}
                value={instr}
                onChange={(e) => setInstr(e.target.value)}
                placeholder={item.kind === "resume" ? "Ask Lookout: lead with the platform work, cut to one page…" : "Ask Lookout: shorter, more specific, mention…"}
                style={{ flex: "1 1 260px", height: 38, borderRadius: 10, border: "1.5px solid #E0D9CF", padding: "0 12px", fontSize: 14 }}
              />
              <button type="submit" disabled={!instr.trim() || !!busy} style={btn("outline")}>
                {busy === "revise" ? "Revising…" : "Revise"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function SendForMe({ d, busy, onFill }: { d: Detail; busy: boolean; onFill: (mode: "test" | "submit") => void }) {
  const f = d.report.fill;
  const [stamp] = useState(() => Date.now());
  return (
    <section aria-labelledby="sfm" style={{ ...card, borderColor: "#1D1A0F", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 id="sfm" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Send it for you</h2>
      <p style={{ ...muted, margin: 0 }}>Lookout fills the real form with the versions you approved. Test fill stops before Submit, so you can check the screenshot first.</p>
      {d.status === "approved" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => onFill("test")} disabled={busy} style={btn("outline")}>
            {busy ? "Working…" : "Test fill (doesn't submit)"}
          </button>
          <button onClick={() => onFill("submit")} disabled={busy} style={btn("solid")}>
            Submit for me
          </button>
        </div>
      )}
      {d.status === "submitting" && <div style={muted}>Sending now…</div>}
      {f && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            Last {f.mode === "test" ? "test fill" : "send"}: {new Date(f.at).toLocaleString()}
          </div>
          {f.stopped && <div role="alert" style={{ fontSize: 14, color: "#99220F" }}>{f.stopped}</div>}
          {f.confirmation && <div style={{ fontSize: 14, color: "#35662A" }}>Confirmation: {f.confirmation}</div>}
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: "#3B362C" }}>
            {f.log.map((l) => (
              <li key={l.prompt}>
                {l.ok ? "✓" : "✗"} {l.prompt} <span style={{ color: "#6B6358" }}>({l.how})</span>
              </li>
            ))}
          </ul>
          <a href={`/api/apply/${d.id}/screenshot?which=${f.mode === "submit" ? "after-submit" : "filled"}&t=${stamp}`} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: "#1D1A0F" }}>
            See the screenshot ↗
          </a>
        </div>
      )}
    </section>
  );
}

function Checklist({ d, onDone }: { d: Detail; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const locked = d.status === "submitted";
  const rows = locked
    ? (d.confirmation?.sent ?? []).map((s, n) => ({ key: String(n), prompt: s.prompt, kind: d.items.find((i) => i.prompt === s.prompt)?.kind ?? "answer", content: s.content }))
    : d.items
        .filter((i) => i.approvedVersionId)
        .map((i) => ({ key: i.id, prompt: i.prompt, kind: i.kind, content: i.versions.find((v) => v.id === i.approvedVersionId)?.content ?? "" }));
  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };
  const download = (prompt: string, text: string) => {
    const url = URL.createObjectURL(new Blob([toPlainText(text)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${d.company} - ${prompt}.txt`.replace(/[\\/:*?"<>|]/g, "-");
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section aria-labelledby="send" style={{ ...card, borderColor: locked ? "#9CC68E" : "#1D1A0F", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 id="send" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{locked ? "What you sent" : "Send it"}</h2>
      {locked ? (
        <p style={{ ...muted, margin: 0 }}>Applied {d.submittedAt ? new Date(d.submittedAt).toLocaleString() : ""}. This is the exact text you approved.</p>
      ) : (
        <p style={{ ...muted, margin: 0 }}>
          Open the application, then copy each answer in. Upload the resume and cover letter as Word files where the form asks for them. Takes about two minutes.
        </p>
      )}
      {!locked && d.report.applyUrl && (
        <a href={d.report.applyUrl} target="_blank" rel="noreferrer" style={{ ...btn("solid"), display: "inline-flex", alignItems: "center", alignSelf: "flex-start", textDecoration: "none" }}>
          Open the application ↗
        </a>
      )}
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <li key={r.key} style={{ fontSize: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 200px", fontWeight: 600 }}>{r.prompt}</span>
              <button onClick={() => copy(r.key, r.kind === "resume" || r.kind === "cover_letter" ? toPlainText(r.content) : r.content)} style={{ ...btn("outline"), height: 32 }}>
                {copied === r.key ? "Copied" : "Copy"}
              </button>
              {(r.kind === "resume" || r.kind === "cover_letter") && !locked && (
                <>
                  <a href={`/api/apply/${d.id}/items/${r.key}/docx`} title="The file Lookout uploads" download style={{ ...btn("solid"), height: 32, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                    Download .docx
                  </a>
                  <button onClick={() => download(r.prompt, r.content)} style={{ ...btn("outline"), height: 32 }}>
                    .txt
                  </button>
                </>
              )}
            </div>
            {r.kind !== "resume" && r.kind !== "cover_letter" && <div style={{ ...muted, whiteSpace: "pre-wrap", marginTop: 2 }}>{r.content.length > 240 ? `${r.content.slice(0, 240)}…` : r.content}</div>}
          </li>
        ))}
      </ol>
      {!locked && (
        <button onClick={onDone} style={{ ...btn("outline"), alignSelf: "flex-start" }}>
          I submitted it
        </button>
      )}
    </section>
  );
}
