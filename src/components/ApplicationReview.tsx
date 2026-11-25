"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ApplicationStatus } from "@/lib/db/schema";
import { useConfirm } from "./Confirm";
import { api } from "./store";
import { letterHeaderFrom, readable, TEMPLATE_STYLE, type Template } from "@/lib/application/resumeLayout";
import { InfoIcon } from "./chat";
import { card, muted, resumeText, type Detail, type Item } from "./review/shared";
import { Checklist } from "./review/Checklist";
import { EeoSection } from "./review/EeoSection";
import { ItemCard } from "./review/ItemCard";
import { KeywordSection } from "./review/KeywordPanel";
import { PostingText } from "./review/PostingText";
import { QuestionRow } from "./review/QuestionRow";
import { SendForMe } from "./review/SendForMe";
import { color, font } from "@/lib/tokens";

export { DocPreview } from "./review/DocPreview";

const WORKING: ApplicationStatus[] = ["queued", "scanning", "drafting"];
const POLL: ApplicationStatus[] = [...WORKING, "submitting"];
const SECTIONS: { title: string; kinds: string[]; help?: string }[] = [
  { title: "Resume", kinds: ["resume"] },
  { title: "Cover letter", kinds: ["cover_letter"] },
  { title: "People to reach", kinds: ["outreach"], help: "Drafts only. Lookout never sends these." },
  { title: "Questions", kinds: ["answer", "portfolio"] },
  { title: "Basic fields", kinds: ["field"], help: "No approval needed." },
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
  // Also while the other cover letter strategies are being written, so their buttons turn on (#1484).
  const writingLetters = !!d?.letter && Object.values(d.letter.items).some((l) => l.writing);
  const polling = (!!d && POLL.includes(d.status)) || (!!testing && (d?.report.fill?.at ?? "none") === testing) || writingLetters;
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
        body: "Lookout fills the form with the versions you approved, then sends it. If Lookout can't complete the form (a CAPTCHA, a field it can't fill), it sends nothing and you finish with the checklist.",
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

  if (!d) return <div className="page-pad lk-page" role="status" style={muted}>{err ?? "Loading…"}</div>;

  const open = d.items.filter((i) => i.question);
  const locked = d.status === "submitted";

  return (
    <div className="page-pad lk-page" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1180 }}>
      <style>{`.lk-review{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}@media(min-width:1000px){.lk-review{grid-template-columns:minmax(0,1fr) 360px}.lk-review aside{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto}}`}</style>
      <Link href="/apply" style={{ fontSize: font.base, color: color.ink }}>← All applications</Link>
      {/* Company first, as on the list; the role is the subtitle (#1664). */}
      <header style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: font["4xl"], fontWeight: 700, letterSpacing: "-0.02em" }}>{d.company}</h1>
          <div style={{ marginTop: 2, fontSize: font.xl, fontWeight: 600, color: color.ink }}>{d.role}</div>
        </div>
      </header>

      <div aria-live="polite" style={{ ...muted, minHeight: 20 }}>{said}</div>
      {err && <div role="alert" style={{ fontSize: font.base, color: color.brick }}>{err}</div>}

      {working && <div style={card}>Lookout is {d.status === "drafting" ? "drafting your application" : "reading the application"}. This takes a minute or two; the page updates on its own.</div>}
      {d.status === "failed" && <div role="alert" style={{ ...card, borderColor: "#E8B4AA", color: color.brick }}>{d.report.error ?? "This one didn't work."} Go back to the list to try again.</div>}

      {!working && d.items.length > 0 && (
        <div className="lk-review">
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {!locked && <Progress steps={reviewSteps(d)} />}

            {open.length > 0 && !locked && (
              <section aria-labelledby="qs" style={{ ...card, borderColor: color.orange, background: "#FFF9F3" }}>
                <h2 id="qs" style={{ margin: "0 0 4px", fontSize: font.xl, fontWeight: 700 }}>Lookout needs you for {open.length === 1 ? "one thing" : `${open.length} things`}</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {open.map((i) => (
                    <QuestionRow key={i.id} item={i} onSave={(content) => act(i.id, { action: "edit", content, note: "Answered by you." }, "Saved. Common answers like this one are kept on your profile for next time.")} />
                  ))}
                </div>
              </section>
            )}

            {!!d.report.traps?.length && !locked && (
              <section aria-labelledby="traps" style={{ ...card, borderColor: "#E8B4AA", background: "#FFF6F4" }}>
                <h2 id="traps" style={{ margin: "0 0 4px", fontSize: font.xl, fontWeight: 700 }}>This posting tries to catch automated applications</h2>
                <p style={{ ...muted, margin: "0 0 10px" }}>
                  Lookout didn&apos;t follow {d.report.traps.length === 1 ? "it" : "them"}. Follow a visible one yourself if you want to.
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: font.base }}>
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
              // An item waiting on an answer sits in the box above, so it isn't asked twice (#1531).
              const list = sectionItems(d.items, s.kinds, locked);
              if (!list.length) return null;
              return (
                <section key={s.title} aria-labelledby={`sec-${s.title}`} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <h2 id={`sec-${s.title}`} style={{ margin: "6px 0 0", fontSize: font.xl, fontWeight: 700 }}>
                    {s.title}
                    {s.help && !locked && (
                      <>
                        {" "}
                        <InfoIcon tip={s.help} label={`About ${s.title}`} />
                      </>
                    )}
                  </h2>
                  {s.title === "Resume" && d.keywordRows && <KeywordSection d={d} rows={d.keywordRows} reload={load} locked={locked} />}
                  {list.map((i) => (
                    <ItemCard key={i.id} appId={d.id} item={i} locked={locked} act={act} analysis={d.report.recruiter?.[i.id]} template={d.template} accent={d.accent} header={i.kind === "cover_letter" ? letterHeaderFrom(resumeText(d), "") : null} letter={i.kind === "cover_letter" && d.letter ? { ...(d.letter.items[i.id] ?? { strategy: d.letter.strategy, ready: [], writing: false }), suggested: d.letter.suggested, why: d.letter.why } : null} onTemplate={pickTemplate} onAccent={pickAccent} needsKeywords={!!d.keywordRows && !d.keywordsApproved} />
                  ))}
                </section>
              );
            })}

            {(d.status === "approved" || d.status === "submitting" || d.report.fill) && d.autoSubmit && <SendForMe d={d} busy={polling} onFill={fill} />}
            {(d.status === "manual" || d.status === "approved" || locked) && <Checklist d={d} onDone={submitted} />}
          </div>

          <aside aria-label="The posting" style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: font.lg, fontWeight: 700 }}>The posting</h2>
            {d.url && (
              <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: font.base, color: color.ink }}>
                Open the original ↗
              </a>
            )}
            {d.posting ? <PostingFold text={d.posting} /> : <div style={muted}>No description saved for this role.</div>}
          </aside>
        </div>
      )}
    </div>
  );
}

type Step = { label: string; done: boolean; href: string };

/**
 * What's left before this application can go (#1664): the keyword list when the resume waits on it, then each
 * required item. An item waiting on an answer points at the questions box, where it's asked.
 */
export function reviewSteps(d: Pick<Detail, "keywordRows" | "keywordsApproved" | "items">): Step[] {
  const label = (i: Item) => (i.kind === "resume" ? "Resume" : i.kind === "cover_letter" ? "Cover letter" : i.prompt);
  return [
    ...(d.keywordRows ? [{ label: "Keywords", done: d.keywordsApproved, href: "#keywords" }] : []),
    ...d.items.filter((i) => i.required && i.kind !== "eeo").map((i) => ({ label: label(i), done: !!i.approvedVersionId, href: i.question ? "#qs" : `#item-${i.id}` })),
  ];
}

const jump = (e: React.MouseEvent<HTMLAnchorElement>) => {
  const el = document.querySelector(e.currentTarget.getAttribute("href") ?? "");
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: "smooth", block: "start" });
};

/** The page's one job in plain words, how far along it is, and what's left; each part left jumps to it (#1664). */
function Progress({ steps }: { steps: Step[] }) {
  const done = steps.filter((s) => s.done).length;
  const left = steps.filter((s) => !s.done);
  return (
    <section aria-label="Progress" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: font.lg, fontWeight: 700 }}>{left.length ? "Approve each part, then send it." : "Everything is approved."}</div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={`${done} of ${steps.length} approved`} style={{ height: 6, borderRadius: 999, background: color.border, overflow: "hidden", maxWidth: 480 }}>
        <div style={{ height: "100%", width: `${steps.length ? (done / steps.length) * 100 : 0}%`, background: color.greenText, borderRadius: 999, transition: "width .3s" }} />
      </div>
      <div style={{ fontSize: font.base, color: color.t2 }}>
        {done} of {steps.length} approved
        {left.length ? (
          <>
            {" · Left: "}
            {left.map((s, n) => (
              <span key={s.href + s.label}>
                {n > 0 && ", "}
                <a href={s.href} onClick={jump} style={{ color: color.ink }}>{s.label}</a>
              </span>
            ))}
          </>
        ) : (
          <>
            {" · "}
            <a href="#send" onClick={jump} style={{ color: color.ink }}>Send it</a>
          </>
        )}
      </div>
    </section>
  );
}

const narrowQuery = "(max-width: 999.98px)";
const onNarrow = (cb: () => void) => {
  const m = window.matchMedia(narrowQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/**
 * The posting beside the drafts on desktop. Below them on a phone it was thousands of pixels of text, so it folds
 * there and opens on a tap (#1531).
 */
function PostingFold({ text }: { text: string }) {
  const narrow = useSyncExternalStore(onNarrow, () => window.matchMedia(narrowQuery).matches, () => false);
  if (!narrow) return <PostingText text={text} />;
  return (
    <details>
      <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", fontSize: font.base, fontWeight: 600 }}>Show the full posting</summary>
      <PostingText text={text} />
    </details>
  );
}

/** One section's items. An item waiting on an answer sits in the box at the top instead, so it isn't asked twice (#1531). */
export const sectionItems = <T extends { kind: string; question: string | null }>(items: T[], kinds: string[], locked: boolean) =>
  items.filter((i) => kinds.includes(i.kind) && (locked || !i.question));
