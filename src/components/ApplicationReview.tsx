"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ApplicationReport, ApplicationStatus } from "@/lib/db/schema";
import { applicationLabel } from "@/lib/applyLabels";
import { btn } from "./Settings";
import { useConfirm } from "./Confirm";
import { api } from "./store";
import { ACCENTS, contactParts, letterHeaderFrom, parseDraft, readable, roleParts, styleFor, TEMPLATE_STYLE, TEMPLATES, toPlain as toPlainText, type Block, type Template } from "@/lib/application/resumeLayout";
import { parseNote } from "@/lib/application/notes";
import { postingBlocks } from "@/lib/application/posting";

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
  /** EEO only: the answer matched from the person's profile (with consent), never stored on the application. */
  eeoAnswer?: string | null;
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
  eeoConsent: boolean;
  template: Template;
  accent: string | null;
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
                  {s.title === "Resume" && d.report.keywords && <KeywordReport d={d} reload={load} locked={locked} />}
                  {list.map((i) => (
                    <ItemCard key={i.id} appId={d.id} item={i} locked={locked} act={act} template={d.template} accent={d.accent} header={i.kind === "cover_letter" ? letterHeaderFrom(resumeText(d), "") : null} onTemplate={pickTemplate} onAccent={pickAccent} />
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

/** The resume or letter as the recruiter sees it: same layout as the .docx Lookout uploads. */
export function DocPreview({ md, template, accent, header }: { md: string; template: Template; accent?: string | null; header?: { name: string; contact: string; headline?: string } | null }) {
  const T = styleFor(template, accent);
  const c = (hex: string) => `#${hex}`;
  const blocks = parseDraft(md);
  // A cover letter carries the resume's header, so both files match.
  const top: Block[] = header && blocks[0]?.t !== "name" ? [{ t: "name", text: header.name }, ...(header.headline ? [{ t: "headline" as const, text: header.headline }] : []), ...(header.contact ? [{ t: "contact" as const, text: header.contact }] : [])] : [];
  const center = T.align === "center";
  return (
    <div style={{ background: "#fff", border: "1px solid #E0D9CF", borderRadius: 6, boxShadow: "0 2px 10px rgba(29,26,15,.08)", padding: "36px 44px", fontFamily: T.css, color: c(T.ink), fontSize: 13.5, lineHeight: 1.45, maxHeight: 640, overflow: "auto" }}>
      {[...top, ...blocks].map((b, i, all) =>
        b.t === "name" ? (
          <div key={i} style={{ fontSize: T.nameSize, fontWeight: T.nameWeight, lineHeight: 1.1, letterSpacing: T.section === "bar" ? "-0.02em" : undefined, textAlign: center ? "center" : "left", marginBottom: 4 }}>{b.text}</div>
        ) : b.t === "headline" ? (
          <div key={i} style={{ fontSize: 16, fontStyle: T.headlineItalic ? "italic" : "normal", fontWeight: T.section === "bar" ? 700 : 400, color: T.section === "bar" ? c(T.accent) : c(T.ink), textAlign: center ? "center" : "left", marginBottom: 4 }}>{b.text}</div>
        ) : b.t === "contact" ? (
          <div key={i} style={{ fontSize: 12.5, color: c(T.muted), textAlign: center ? "center" : "left", marginBottom: top.length && i === top.length - 1 ? 22 : 0 }}>
            {contactParts(b.text).map((p, j) => (
              <span key={j}>
                {j > 0 && <span aria-hidden> • </span>}
                {p.href ? (
                  <a href={p.href} target={p.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" style={{ color: c(T.accent) }}>
                    {p.text}
                  </a>
                ) : (
                  p.text
                )}
              </span>
            ))}
          </div>
        ) : b.t === "section" ? (
          <div
            key={i}
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: T.section === "rule" ? c(T.ink) : c(T.accent),
              textAlign: T.section === "rule" && center ? "center" : "left",
              margin: "18px 0 6px",
              ...(T.section === "rule" ? { borderBottom: "1px solid #999", paddingBottom: 2 } : T.section === "bar" ? { borderLeft: `4px solid ${c(T.accent)}`, paddingLeft: 8 } : {}),
            }}
          >
            {b.text}
          </div>
        ) : b.t === "role" ? (
          <div key={i} style={{ display: "flex", gap: 12, justifyContent: "space-between", fontWeight: 700, margin: "10px 0 2px" }}>
            {T.section === "bar" ? (
              <span>
                <span style={{ color: c(T.accent) }}>{roleParts(all, i).title}</span>
                {roleParts(all, i).rest}
              </span>
            ) : (
              <span>{b.text}</span>
            )}
            {b.right && <span style={{ fontWeight: 400, color: c(T.muted), whiteSpace: "nowrap" }}>{b.right}</span>}
          </div>
        ) : b.t === "subrole" ? (
          <div key={i} style={{ display: "flex", gap: 12, justifyContent: "space-between", fontWeight: 600, fontStyle: T.headlineItalic ? "italic" : "normal", color: T.section === "bar" ? c(T.accent) : c(T.ink), margin: "6px 0 2px" }}>
            <span>{b.text}</span>
            {b.right && <span style={{ fontWeight: 400, fontStyle: "normal", color: c(T.muted), whiteSpace: "nowrap" }}>{b.right}</span>}
          </div>
        ) : b.t === "bullet" ? (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "14px 1fr", margin: "1px 0" }}>
            <span aria-hidden style={{ color: T.section === "bar" ? c(T.accent) : undefined }}>•</span>
            <span>{b.text}</span>
          </div>
        ) : (
          <p key={i} style={{ margin: "0 0 8px" }}>{b.text}</p>
        ),
      )}
    </div>
  );
}

/** The posting, readable: key facts first, then its own headings, lists and paragraphs. */
function PostingText({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 14, lineHeight: 1.55, color: "#3B362C", display: "flex", flexDirection: "column", gap: 8 }}>
      {postingBlocks(text).map((b, i) =>
        b.t === "facts" ? (
          <dl key={i} style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", padding: 12, borderRadius: 10, background: "#FAF8F5" }}>
            {b.rows.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt style={{ fontWeight: 600, color: "#6B6358" }}>{k}</dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>
        ) : b.t === "heading" ? (
          <h3 key={i} style={{ margin: "8px 0 0", fontSize: 15, fontWeight: 700, color: "#1D1A0F" }}>{b.text}</h3>
        ) : b.t === "bullets" ? (
          <ul key={i} style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
            {b.items.map((x, j) => (
              <li key={j}>{x}</li>
            ))}
          </ul>
        ) : (
          <p key={i} style={{ margin: 0 }}>{b.text}</p>
        ),
      )}
    </div>
  );
}

/** Classic, Modern or Cool, saved for the person; the .docx Lookout uploads uses the same one (#129). Cool takes a highlight color (#137). */
function TemplatePicker({ value, accent, onPick, onAccent }: { value: Template; accent?: string | null; onPick: (t: Template) => void; onAccent: (hex: string) => void }) {
  const cur = styleFor(value, accent).accent;
  const [custom, setCustom] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div role="radiogroup" aria-label="Resume design" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, color: "#6B6358", marginRight: 4 }}>Design</span>
        {TEMPLATES.map((t) => (
          <button key={t} role="radio" aria-checked={value === t} onClick={() => onPick(t)} style={{ height: 32, padding: "0 12px", borderRadius: 999, border: `1.5px solid ${value === t ? "#1D1A0F" : "#E0D9CF"}`, background: value === t ? "#1D1A0F" : "#fff", color: value === t ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            {TEMPLATE_STYLE[t].label}
          </button>
        ))}
      </div>
      {value === "cool" && (
        <div role="radiogroup" aria-label="Highlight color" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: "#6B6358", marginRight: 4 }}>Highlight</span>
          {ACCENTS.map(([name, hex]) => (
            <button key={hex} role="radio" aria-checked={cur === hex} aria-label={name} title={name} onClick={() => onAccent(hex)} style={{ width: 26, height: 26, borderRadius: "50%", border: cur === hex ? "2px solid #1D1A0F" : "2px solid #fff", outline: "1px solid #E0D9CF", background: `#${hex}`, cursor: "pointer" }} />
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#6B6358", cursor: "pointer" }}>
            <input
              type="color"
              aria-label="Custom highlight color"
              value={`#${cur}`}
              onChange={(e) => setCustom(e.target.value.slice(1).toUpperCase())}
              onBlur={() => custom && onAccent(custom)}
              style={{ width: 30, height: 26, border: 0, padding: 0, background: "none", cursor: "pointer" }}
            />
            Custom
          </label>
          {custom && readable(custom) !== custom && <span style={{ fontSize: 14, color: "#6B6358" }}>Darkened a little so text stays readable.</span>}
        </div>
      )}
    </div>
  );
}

/**
 * What changed in a version and where its facts came from. Reading it is optional, so anything
 * longer than a line sits in a collapsed section.
 */
function VersionNotes({ v }: { v: Version }) {
  const head = `v${v.version} by ${v.author === "ai" ? "Lookout" : "you"}`;
  const points = parseNote(v.note);
  const sources = v.sources.filter((s) => s !== "you");
  if (points.length <= 1 && sources.length <= 1)
    return (
      <div style={muted}>
        {head}
        {points[0] ? `: ${points[0].text}` : ""}
        {sources[0] ? ` · Source: ${sources[0]}` : ""}
      </div>
    );
  return (
    <details style={{ ...muted }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        {head}: what changed and why ({points.length} note{points.length === 1 ? "" : "s"}
        {sources.length ? `, ${sources.length} source${sources.length === 1 ? "" : "s"}` : ""})
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
        {points.length > 0 && <NoteList note={v.note} />}
        {sources.length > 0 && (
          <div>
            <div style={{ fontWeight: 600 }}>Sources</div>
            <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
              {sources.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

/** A version note as a list: one point per change, sub-points for what was added where. */
function NoteList({ note }: { note: string }) {
  const points = parseNote(note);
  return (
    <div>
      <ul style={{ margin: "2px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
        {points.map((p, i) => (
          <li key={i}>
            {p.text}
            {p.sub.length > 0 && (
              <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                {p.sub.map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function KeywordReport({ d, reload, locked }: { d: Detail; reload: () => Promise<unknown>; locked: boolean }) {
  const k = d.report.keywords ?? [];
  const choices = d.report.keywordChoices ?? { include: [], exclude: [] };
  const resume = d.items.find((i) => i.kind === "resume");
  const [open, setOpen] = useState<string | null>(null);
  const [story, setStory] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const picked = (t: string) => (choices.include.some((x) => x.toLowerCase() === t.toLowerCase()) ? "include" : choices.exclude.some((x) => x.toLowerCase() === t.toLowerCase()) ? "exclude" : null);
  const inDraft = (x: (typeof k)[number]) => (x.after && picked(x.term) !== "exclude") || picked(x.term) === "include";
  // Picks made since the resume was last written.
  const pending = [...choices.include.map((t) => [t, "include"]), ...choices.exclude.map((t) => [t, "exclude"])].filter(([t, c]) => k.find((x) => x.term.toLowerCase() === t.toLowerCase())?.choice !== c).length;
  const before = k.filter((x) => x.before).length;
  const after = k.filter((x) => x.after).length;

  const pick = async (term: string, action: "include" | "exclude" | "reset", withStory?: string) => {
    setBusy(term);
    setErr(null);
    try {
      await api(`/api/apply/${d.id}/keywords`, { method: "POST", json: { term, action, ...(withStory !== undefined ? { story: withStory } : {}) } });
      await reload();
      setOpen(null);
      setStory("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    }
    setBusy(null);
  };
  const update = async () => {
    if (!resume) return;
    setBusy("__update");
    setErr(null);
    try {
      await api(`/api/apply/${d.id}/items/${resume.id}`, { method: "POST", json: { action: "redraft" } });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update");
    }
    setBusy(null);
  };
  const cur = k.find((x) => x.term === open);

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>
        Keyword match {before}/{k.length} → {after}/{k.length}
      </div>
      <div style={muted}>
        Terms from the posting that applicant tracking systems screen for. Green: in this resume. Struck through: not in your experience as Lookout knows it. {locked ? "" : "Click any keyword to change it, or to tell Lookout about experience your resume leaves out."}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {k.map((x) => {
          const on = inDraft(x);
          const c = picked(x.term);
          return (
            <li key={x.term}>
              <button
                disabled={locked}
                onClick={() => {
                  setOpen(open === x.term ? null : x.term);
                  setStory("");
                }}
                aria-expanded={open === x.term}
                title={x.where ? `Added in ${x.where}` : x.before ? "Already in your resume" : "Not in your experience as Lookout knows it"}
                style={{ padding: "4px 10px", borderRadius: 999, fontSize: 14, cursor: locked ? "default" : "pointer", border: c ? `1.5px dashed ${c === "include" ? "#35662A" : "#99220F"}` : "1.5px solid transparent", background: on ? "#E3EFDD" : "#F4F1EC", color: on ? "#35662A" : "#6B6358", textDecoration: on ? "none" : "line-through" }}
              >
                {x.term}
                {c === "include" ? " · added by you" : c === "exclude" ? " · left out" : x.after && !x.before ? " +" : ""}
              </button>
            </li>
          );
        })}
      </ul>
      {cur && !locked && (
        <div style={{ padding: 14, borderRadius: 12, background: "#FAF8F5", border: "1px solid #E6E0D8", display: "flex", flexDirection: "column", gap: 8 }}>
          {picked(cur.term) ? (
            <>
              <div style={{ fontSize: 14 }}>You {picked(cur.term) === "include" ? "added" : "left out"} “{cur.term}”.</div>
              <button onClick={() => pick(cur.term, "reset")} disabled={!!busy} style={{ ...btn("outline"), alignSelf: "flex-start" }}>
                Undo
              </button>
            </>
          ) : cur.after ? (
            <>
              <div style={{ fontSize: 14 }}>“{cur.term}” is in this resume{cur.where ? ` (${cur.where})` : ""}.</div>
              <button onClick={() => pick(cur.term, "exclude")} disabled={!!busy} style={{ ...btn("outline"), alignSelf: "flex-start" }}>
                Leave it out
              </button>
            </>
          ) : (
            <>
              <label htmlFor="kw-story" style={{ fontSize: 15, fontWeight: 600 }}>
                Do you have experience with “{cur.term}”?
              </label>
              <div style={muted}>Tell Lookout where: a role, a project, a result, something your resume leaves out. It goes into your experience notes and is used for this resume and future applications. You can edit it on your profile.</div>
              <textarea id="kw-story" value={story} onChange={(e) => setStory(e.target.value)} rows={3} maxLength={1500} placeholder="e.g. I use Claude and Claude Code daily; I built a multi-agent setup that writes and ships code for my side project." style={{ borderRadius: 10, border: "1.5px solid #E0D9CF", padding: 10, fontSize: 15, fontFamily: "inherit", resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => pick(cur.term, "include", story)} disabled={!!busy || !story.trim()} style={btn("solid")}>
                  Add it with this
                </button>
                <button onClick={() => pick(cur.term, "include", "")} disabled={!!busy} style={btn("text")}>
                  Add it without details
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {pending > 0 && !locked && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            You changed {pending} keyword{pending === 1 ? "" : "s"}.
          </span>
          <button onClick={update} disabled={!!busy} style={btn("solid")}>
            {busy === "__update" ? "Rewriting the resume…" : "Update the resume"}
          </button>
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 14, color: "#99220F" }}>{err}</div>}
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
      {!item.question?.toLowerCase().includes(item.prompt.toLowerCase().slice(0, 40)) && <div style={muted}>For: {item.prompt}</div>}
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

/** The resume as it will go out: the approved version, else the latest. */
const resumeText = (d: Detail) => {
  const r = d.items.find((i) => i.kind === "resume");
  return (r?.versions.find((v) => v.id === r.approvedVersionId) ?? r?.versions[0])?.content;
};

function ItemCard({ appId, item, locked, act, template, accent, header, onTemplate, onAccent }: { appId: string; item: Item; locked: boolean; act: Act; template: Template; accent: string | null; header: { name: string; contact: string; headline?: string } | null; onTemplate: (t: Template) => void; onAccent: (hex: string) => void }) {
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
        <>
          {!locked && <TemplatePicker value={template} accent={accent} onPick={onTemplate} onAccent={onAccent} />}
          <DocPreview md={text} template={template} accent={accent} header={header} />
        </>
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

      {shown && <VersionNotes v={shown} />}

      {!locked && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {doc && (
              <button onClick={() => setEditing((e) => !e)} aria-pressed={editing} style={btn("outline")}>
                {editing ? "Preview" : "Edit text"}
              </button>
            )}
            {item.kind === "resume" && !dirty && (
              <button onClick={() => run("revise", { action: "redraft" }, "Lookout wrote a fresh resume from the posting.")} disabled={!!busy} style={btn("text")}>
                {busy === "revise" ? "Working…" : "Redraft from the posting"}
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

/** Voluntary EEO questions (#122): filled only from the person's own answers, with their permission. */
function EeoSection({ d, act }: { d: Detail; act: Act }) {
  const qs = d.items.filter((i) => i.kind === "eeo");
  if (!d.eeoConsent)
    return (
      <div style={{ ...card, ...muted }}>
        This form has {qs.length} voluntary EEO question{qs.length === 1 ? "" : "s"} (gender, race, veteran and disability status). Lookout leaves them blank. To have Lookout answer them from your own answers, set them up in <Link href="/profile/application">Profile › Application answers</Link>.
      </div>
    );
  return (
    <section aria-labelledby="eeo" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 id="eeo" style={{ margin: "6px 0 0", fontSize: 18, fontWeight: 700 }}>Voluntary questions (EEO)</h2>
      <div style={{ ...muted, marginTop: -4 }}>From your answers on your profile. Never shared with an AI. Change one here and Lookout remembers it for this wording.</div>
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
        {qs.map((q) => (
          <div key={q.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label htmlFor={`eeo-${q.id}`} style={{ fontSize: 15, fontWeight: 600 }}>{q.prompt}</label>
            <select
              id={`eeo-${q.id}`}
              value={q.eeoAnswer ?? ""}
              onChange={(e) => act(q.id, { action: "edit", content: e.target.value, note: "" }, "Saved for this wording.")}
              style={{ height: 40, borderRadius: 10, border: "1.5px solid #E0D9CF", padding: "0 10px", fontSize: 15, maxWidth: 520 }}
            >
              <option value="">Leave blank</option>
              {(q.options ?? []).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <div style={muted}>{q.eeoAnswer ? "✓ Will be filled" : "Blank. Lookout couldn't match your answer to this wording; pick one or leave it blank."}</div>
          </div>
        ))}
      </div>
    </section>
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
      {!locked && d.eeoConsent && d.items.some((i) => i.kind === "eeo" && i.eeoAnswer) && (
        <div style={{ fontSize: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Voluntary EEO (pick these in the form)</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "#3B362C" }}>
            {d.items
              .filter((i) => i.kind === "eeo" && i.eeoAnswer)
              .map((i) => (
                <li key={i.id}>
                  {i.prompt}: {i.eeoAnswer}
                </li>
              ))}
          </ul>
        </div>
      )}
      {!locked && (
        <button onClick={onDone} style={{ ...btn("outline"), alignSelf: "flex-start" }}>
          I submitted it
        </button>
      )}
    </section>
  );
}
