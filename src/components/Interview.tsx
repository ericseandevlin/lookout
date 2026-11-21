"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { InterviewView, ViewFact, ViewTurn } from "@/lib/interview/session";
import { PageHead, ProfileTabs } from "./Profile";
import { btn } from "./Settings";
import { api, useStore } from "./store";
import { color, font } from "@/lib/tokens";

const card: React.CSSProperties = { background: "#fff", border: `1.5px solid ${color.border}`, borderRadius: 14, padding: 20 };
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/** Profile > Interview (#1449): one question at a time, from what the person's top finds ask for. */
export function Interview() {
  const { state } = useStore();
  const [data, setData] = useState<InterviewView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "answer" | "skip" | "not_applicable">(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const first = state.user.name.trim().split(/\s+/)[0];

  useEffect(() => {
    api<InterviewView>("/api/interview")
      .then((d) => {
        setData(d);
        // A quote link from What Lookout knows lands on its turn.
        const id = window.location.hash.slice(1);
        if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "center" }));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load the interview"));
  }, []);

  const send = async (action: "answer" | "skip" | "not_applicable") => {
    if (!data?.current || busy) return;
    if (action === "answer" && !text.trim()) {
      setErr("Type an answer first, or press Skip.");
      box.current?.focus();
      return;
    }
    setBusy(action);
    setErr(null);
    try {
      const d = await api<InterviewView>("/api/interview", { method: "POST", json: { turnId: data.current.id, action, text } });
      setData(d);
      setText("");
      requestAnimationFrame(() => box.current?.focus());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setBusy(null);
    }
  };

  const today = data?.turns.flatMap((t) => t.facts).filter((f) => isToday(f.createdAt)) ?? [];
  const cur = data?.current;

  return (
    <div className="page-pad lk-page w-wide" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ProfileTabs />
      <PageHead
        eyebrow="Search profile"
        title="Interview"
        intro="Lookout asks one question at a time, about what your top finds want and your profile doesn't show yet. Stop whenever you like; pick up where you left off."
      />
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <section aria-label="Interview" style={{ ...card, flex: "1 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          {!data && !err && <div style={{ fontSize: font.lg, color: color.t2 }}>Getting your next question…</div>}
          {data && (
            <>
              <Said who="Lookout">
                {data.turns.length ? `Welcome back${first ? `, ${first}` : ""}.` : `Hi${first ? ` ${first}` : ""}.`} Got five minutes? Stop whenever you want. Every answer saves as you go.
              </Said>
              {data.turns.map((t) => (
                <Past key={t.id} t={t} />
              ))}
              {cur && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <Question t={cur} />
                  <label htmlFor="iv-answer" className="sr-only">Your answer</label>
                  <textarea
                    id="iv-answer"
                    ref={box}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send("answer"); } }}
                    rows={4}
                    maxLength={4000}
                    disabled={!!busy}
                    placeholder="Say it the way you'd tell a friend. Numbers help."
                    style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${color.border}`, fontSize: font.lg, lineHeight: 1.5, resize: "vertical", color: color.ink, background: "#fff" }}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button onClick={() => send("answer")} disabled={!!busy} style={btn("solid")}>{busy === "answer" ? "Reading your answer…" : "Send"}</button>
                    <button onClick={() => send("skip")} disabled={!!busy} style={btn("outline")}>{busy === "skip" ? "Skipping…" : "Skip this one"}</button>
                    <button onClick={() => send("not_applicable")} disabled={!!busy} style={btn("outline")}>{busy === "not_applicable" ? "Saving…" : "Doesn't apply to me"}</button>
                  </div>
                  <div style={{ fontSize: font.sm, color: color.t2 }}>Skip and Doesn&apos;t apply are saved too. Lookout won&apos;t ask that one again.</div>
                </div>
              )}
              {!cur && data.note && <Said who="Lookout">{data.note}</Said>}
            </>
          )}
          {err && <div role="alert" style={{ fontSize: font.lg, color: color.brick }}>{err}</div>}
        </section>

        <aside style={{ flex: "0 1 300px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: font.base, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: color.t2 }}>Saved from today</h2>
            <div style={{ fontSize: font.xl, fontWeight: 700 }}>
              {today.length} {today.length === 1 ? "fact" : "facts"} saved
            </div>
            {today.some((f) => !f.shareable) && <div style={{ fontSize: font.base, color: color.t2 }}>{today.filter((f) => !f.shareable).length} kept private</div>}
          </div>
          {data && (
            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, fontSize: font.base, lineHeight: 1.45 }}>
              <div>
                Lookout knows {data.knows} {data.knows === 1 ? "fact" : "facts"} about you.{" "}
                {data.private > 0 && `${data.private} ${data.private === 1 ? "is" : "are"} private and never used in writing.`}
              </div>
              <Link href="/profile/knows" style={{ fontWeight: 600, color: color.brick, textDecoration: "none" }}>See and edit what Lookout knows →</Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// Chat bubbles: the side says who is talking, so there is no name above them. Screen readers still hear it.
const bubble = (you: boolean): React.CSSProperties => ({
  position: "relative", maxWidth: 620, padding: "11px 15px", borderRadius: 14, fontSize: font.lg, lineHeight: 1.5, textWrap: "pretty", whiteSpace: "pre-wrap",
  background: you ? color.surface : "#fff", border: you ? "none" : `1.5px solid ${color.border}`,
});

function Said({ who, children, id }: { who: "Lookout" | "You"; children: React.ReactNode; id?: string }) {
  const you = who === "You";
  return (
    <div id={id} style={{ display: "flex", flexDirection: "column", alignItems: you ? "flex-end" : "flex-start", scrollMarginTop: 80 }}>
      <div style={bubble(you)}>
        <span className="sr-only">{you ? "You said: " : "Lookout: "}</span>
        {children}
      </div>
    </div>
  );
}

/** The question bubble, with "Why this question?" as an icon in its corner. */
function Question({ t }: { t: ViewTurn }) {
  const [why, setWhy] = useState(false);
  const whyId = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <div style={{ ...bubble(false), ...(t.why && { paddingRight: 46 }) }}>
        <span className="sr-only">Lookout: </span>
        {t.question}
        {t.why && (
          <button
            onClick={() => setWhy(!why)}
            aria-expanded={why}
            aria-controls={whyId}
            aria-label="Why this question?"
            data-tip="Why this question?"
            style={{ position: "absolute", right: 6, bottom: 6, width: 32, height: 32, padding: 0, border: 0, borderRadius: 999, background: why ? color.surface : "transparent", color: why ? color.ink : color.t2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9.5" />
              <path d="M12 11v5.5" />
              <circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>
      {t.why && (
        <div id={whyId} hidden={!why} style={{ fontSize: font.lg, lineHeight: 1.5, color: color.t2, maxWidth: 620, paddingLeft: 4 }}>
          {t.why}
        </div>
      )}
    </div>
  );
}

function Past({ t }: { t: ViewTurn }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Question t={t} />
      <Said who="You" id={`turn-${t.id}`}>
        {t.outcome === "answered" ? t.answer : t.outcome === "skipped" ? <em>Skipped</em> : <em>Doesn&apos;t apply to me</em>}
      </Said>
      {t.facts.length > 0 && <Saved facts={t.facts} />}
    </div>
  );
}

/**
 * What an answer saved, as one quiet line that opens on click, so the conversation stays in front (Eric, 2026-11-21).
 * Private facts sit in the same list with their lock and the reason.
 */
function Saved({ facts }: { facts: ViewFact[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const kept = facts.filter((f) => !f.shareable).length;
  return (
    <div style={{ alignSelf: "flex-end", maxWidth: 620, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={listId}
        style={{ border: 0, background: "transparent", padding: "4px 2px", display: "flex", alignItems: "center", gap: 6, fontSize: font.lg, color: color.t2, cursor: "pointer" }}
      >
        Saved {facts.length} {facts.length === 1 ? "fact" : "facts"}
        {kept > 0 && `, ${kept} kept private`}
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div id={listId} hidden={!open} style={{ alignSelf: "stretch", textAlign: "left", color: color.t2, fontSize: font.lg, lineHeight: 1.5 }}>
        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
          {facts.map((f) => (
            <li key={f.id}>
              {f.text}
              {!f.shareable && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 6 }}>
                  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                  Kept private{f.lockReason ? `: ${f.lockReason}` : "."}
                </span>
              )}
            </li>
          ))}
        </ul>
        <Link href="/profile/knows" style={{ display: "inline-block", marginTop: 6, color: color.t2, textDecoration: "underline", textUnderlineOffset: 3 }}>Edit these</Link>
      </div>
    </div>
  );
}
