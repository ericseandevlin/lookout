"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { InterviewView, ViewFact, ViewTurn } from "@/lib/interview/session";
import { Composer, QuestionBubble, Said, Thinking } from "./chat";
import { PageHead, ProfileTabs } from "./Profile";
import { btn } from "./Settings";
import { api, useStore } from "./store";
import { color, font } from "@/lib/tokens";

const card: React.CSSProperties = { background: "#fff", border: `1.5px solid ${color.border}`, borderRadius: 14, padding: 20 };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
/** Within this many pixels of the bottom, new turns scroll into view; further up, the reader stays put. */
const STICK_PX = 80;

/** Keep going is remembered for the rest of the sitting, in this tab only. */
const keptKey = (d: InterviewView) => `lookout:interview-kept:${d.turns[0]?.id ?? "new"}`;
const readKept = (d: InterviewView) => {
  try {
    return Number(sessionStorage.getItem(keptKey(d)) ?? -1);
  } catch {
    return -1;
  }
};

type Earlier = { open: boolean; turns: ViewTurn[]; more: boolean; loading: boolean };

/** Profile > Interview (#1449): one question at a time, from what the person's top finds ask for. */
/** app: opened from that application's keywords (#1485). Its missing keywords come first, and a link leads back. */
export function Interview({ app }: { app?: string }) {
  const { state } = useStore();
  const [data, setData] = useState<InterviewView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "answer" | "skip">(null);
  const [pending, setPending] = useState<{ text: string | null } | null>(null);
  const [early, setEarly] = useState<Earlier>({ open: false, turns: [], more: true, loading: false });
  // The topic count at which the person last pressed Keep going: the soft stop comes back 5 topics later.
  const [keptAt, setKeptAt] = useState(-1);
  const [height, setHeight] = useState<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const anchor = useRef<{ h: number; top: number } | null>(null);
  const first = state.user.name.trim().split(/\s+/)[0];
  const loaded = !!data;

  // The chat fills the window under the header; the input sits at its foot.
  useLayoutEffect(() => {
    const fit = () => {
      const el = frame.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bar = document.querySelector<HTMLElement>("nav.mob-only")?.offsetHeight ?? 0;
      const pad = parseFloat(getComputedStyle(el.closest(".page-pad") ?? el).paddingBottom) || 16;
      // Never so short that the pinned input leaves little room for the chat (phones scroll the page instead).
      setHeight(Math.max(520, window.innerHeight - top - bar - pad));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [loaded]);

  const loadEarlier = async (before: string | null) => {
    setEarly((e) => ({ ...e, open: true, loading: true }));
    try {
      const page = await api<{ turns: ViewTurn[]; more: boolean }>(`/api/interview?earlier=1${before ? `&before=${before}` : ""}`);
      const el = scroller.current;
      if (el) anchor.current = { h: el.scrollHeight, top: el.scrollTop };
      setEarly((e) => ({ open: true, turns: [...page.turns, ...e.turns], more: page.more, loading: false }));
      return page;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load earlier answers");
      setEarly((x) => ({ ...x, loading: false }));
      return null;
    }
  };

  useEffect(() => {
    api<InterviewView>(app ? `/api/interview?app=${app}` : "/api/interview")
      .then(async (d) => {
        setData(d);
        setKeptAt(readKept(d));
        // A quote link from What Lookout knows lands on its turn, paging back to it if it's from an earlier sitting.
        const id = window.location.hash.slice(1);
        if (!id) return;
        stick.current = false;
        let before = d.earlierBefore;
        for (let i = 0; i < 10 && !d.turns.some((t) => `turn-${t.id}` === id) && d.earlier > 0; i++) {
          const page = await loadEarlier(before);
          if (!page || page.turns.some((t) => `turn-${t.id}` === id) || !page.more) break;
          before = page.turns[0]?.id ?? null;
        }
        requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "center" }));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load the interview"));
  }, [app]);

  // Earlier answers open above the reader: keep what they were reading in the same place.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && anchor.current) {
      el.scrollTop = el.scrollHeight - anchor.current.h + anchor.current.top;
      anchor.current = null;
    }
  }, [early.turns]);

  const softStop = !!data?.softStop && data.sitting.topics >= keptAt + 5;

  // New turns scroll into view, unless the person scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [data, softStop, busy, height]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
  };

  const send = async (action: "answer" | "skip") => {
    if (!data?.current || busy) return;
    if (action === "answer" && !text.trim()) {
      setErr("Type an answer first, or press Skip.");
      box.current?.focus();
      return;
    }
    // The person just acted, so their turn and the reply come into view. The answer moves into the chat right away and
    // Lookout's thinking shows under it until the reply comes back.
    stick.current = true;
    const said = text;
    setBusy(action);
    setPending({ text: action === "answer" ? said.trim() : null });
    setText("");
    setErr(null);
    try {
      const d = await api<InterviewView>("/api/interview", { method: "POST", json: { turnId: data.current.id, action, text: said, app } });
      setData(d);
      requestAnimationFrame(() => box.current?.focus());
    } catch (e) {
      setText(said);
      setErr(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setPending(null);
      setBusy(null);
    }
  };

  const keepGoing = () => {
    stick.current = true;
    if (!data) return;
    setKeptAt(data.sitting.topics);
    try {
      sessionStorage.setItem(keptKey(data), String(data.sitting.topics));
    } catch {}
    requestAnimationFrame(() => box.current?.focus());
  };

  const cur = data?.current;
  const ask = cur && !softStop;
  const earlierRows = early.open ? early.turns : [];

  return (
    <div className="page-pad lk-page w-wide" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ProfileTabs />
      {app && (
        <Link href={`/apply/${app}#keywords`} style={{ alignSelf: "flex-start", fontSize: font.base, fontWeight: 600, color: color.brick, textDecoration: "none" }}>
          ← Back to application
        </Link>
      )}
      <PageHead
        eyebrow="Search profile"
        title="Interview"
        intro="Lookout asks one question at a time, about what your top finds want and your profile doesn't show yet. Stop whenever you like; pick up where you left off."
      />
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <section
          ref={frame}
          aria-label="Interview"
          style={{ ...card, padding: 0, flex: "1 1 480px", minWidth: 0, display: "flex", flexDirection: "column", height: height ?? 560, overflow: "hidden" }}
        >
          <div ref={scroller} data-chat-scroll="" onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
            {!data && !err && <div style={{ fontSize: font.lg, color: color.t2 }}>Getting your next question…</div>}
            {data && (
              <>
                {data.earlier > 0 && (
                  <EarlierRow
                    count={data.earlier}
                    early={early}
                    onToggle={() => (early.open || early.turns.length ? setEarly((e) => ({ ...e, open: !e.open })) : loadEarlier(data.earlierBefore))}
                    onMore={() => loadEarlier(early.turns[0]?.id ?? data.earlierBefore)}
                  />
                )}
                {earlierRows.map((t) => (
                  <Past key={t.id} t={t} />
                ))}
                <Said who="Lookout">
                  {data.earlier || data.turns.length ? `Welcome back${first ? `, ${first}` : ""}.` : `Hi${first ? ` ${first}` : ""}.`} Got five minutes? Stop whenever you want. Every answer saves as you go.
                </Said>
                {data.turns.map((t) => (
                  <Past key={t.id} t={t} />
                ))}
                {ask && <Question t={cur} />}
                {pending && (
                  <>
                    <Said who="You" rise>
                      {pending.text ?? <em>Skipped</em>}
                    </Said>
                    <Thinking />
                  </>
                )}
                {cur && softStop && (
                  <Said who="Lookout">
                    Good place to stop. {plural(data.sitting.facts, "fact")} saved today. Your next question will be here when you come back.
                  </Said>
                )}
                {!cur && data.note && <Said who="Lookout">{data.note}</Said>}
              </>
            )}
          </div>

          {(ask || (cur && softStop) || err) && (
            <div style={{ borderTop: `1.5px solid ${color.border}`, padding: "14px 20px 16px", display: "flex", flexDirection: "column", gap: 10, background: "#fff" }}>
              {err && <div role="alert" style={{ fontSize: font.lg, color: color.brick }}>{err}</div>}
              {cur && softStop && (
                <div>
                  <button onClick={keepGoing} style={btn("solid")}>Keep going</button>
                </div>
              )}
              {ask && (
                <>
                  <Composer id="iv-answer" boxRef={box} value={text} onChange={setText} onSend={() => send("answer")} onSkip={() => send("skip")} busy={busy} />
                </>
              )}
            </div>
          )}
        </section>

        <aside style={{ flex: "0 1 300px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: font.base, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: color.t2 }}>Saved from today</h2>
            <div style={{ fontSize: font.xl, fontWeight: 700 }}>{plural(data?.sitting.facts ?? 0, "fact")} saved</div>
            {!!data?.sitting.private && <div style={{ fontSize: font.base, color: color.t2 }}>{data.sitting.private} kept private</div>}
          </div>
          {data && (
            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, fontSize: font.base, lineHeight: 1.45 }}>
              <div>
                Lookout knows {plural(data.knows, "fact")} about you.{" "}
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

/** Earlier sittings, folded into one row. Opening it loads one page; older pages load on request. */
function EarlierRow({ count, early, onToggle, onMore }: { count: number; early: Earlier; onToggle: () => void; onMore: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <button
        onClick={onToggle}
        aria-expanded={early.open}
        disabled={early.loading && !early.turns.length}
        style={{ border: 0, background: "transparent", padding: "4px 2px", display: "flex", alignItems: "center", gap: 6, fontSize: font.lg, color: color.t2, cursor: "pointer" }}
      >
        Earlier answers ({count})
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: early.open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {early.open && early.more && early.turns.length > 0 && (
        <button onClick={onMore} disabled={early.loading} style={{ ...btn("outline"), fontSize: font.base }}>
          {early.loading ? "Loading…" : "Show older answers"}
        </button>
      )}
      {early.loading && !early.turns.length && <div style={{ fontSize: font.base, color: color.t2 }}>Loading…</div>}
    </div>
  );
}

// Chat bubbles: the side says who is talking, so there is no name above them. Screen readers still hear it.
const Question = ({ t }: { t: ViewTurn }) => <QuestionBubble question={t.question} why={t.why} />;

function Past({ t }: { t: ViewTurn }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Question t={t} />
      <Said who="You" id={`turn-${t.id}`}>
        {t.outcome === "answered" ? t.answer : <em>Skipped</em>}
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
