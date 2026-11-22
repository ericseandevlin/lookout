"use client";

import { useEffect, useState } from "react";
import type { KeywordRow } from "@/lib/application/evidence";
import type { KeywordInterview as Out, KeywordQuestion } from "@/lib/interview/keywords";
import { TapTip } from "../chat";
import { btn } from "../Settings";
import { api } from "../store";
import { KeywordInterview } from "./KeywordInterview";
import { KeywordReport } from "./KeywordReport";
import { card, type Detail } from "./shared";
import { color, font } from "@/lib/tokens";

type Props = { d: Detail; rows: KeywordRow[]; reload: () => Promise<unknown>; locked: boolean };

/** The keyword panel for the resume: the one that uses the interview with FEATURE_INTERVIEW on, the older one without. */
export function KeywordSection(p: Props) {
  return p.d.interviewKeywords ? <KeywordPanel {...p} /> : <KeywordReport {...p} />;
}

const body: React.CSSProperties = { fontSize: font.lg, lineHeight: 1.5 };
const muted: React.CSSProperties = { ...body, color: color.t2 };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const lower = (s: string) => s.toLowerCase();

/** What the tooltip on a keyword says: where the posting asks for it, and what backs it. */
export function keywordTip(r: KeywordRow) {
  const asked = r.snippet ? `Posting: “${r.snippet}”` : r.mine ? "You added this one." : "Not found in the posting text.";
  return r.support ? `${asked}\nYour experience: “${r.support.line}”` : asked;
}

/**
 * Keywords for this resume (#1485): what the resume already backs, what's missing, and one way to back the missing
 * ones, a few interview questions. Each keyword has one control, x for not relevant; its posting quote is a tooltip.
 */
export function KeywordPanel({ d, rows, reload, locked }: Props) {
  const [questions, setQuestions] = useState<KeywordQuestion[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const picks = d.keywordPicks ?? [];
  const starred = (r: KeywordRow) => picks.some((p) => lower(p) === lower(r.term));
  const live = rows.filter((r) => !r.removed);
  const backed = live.filter((r) => r.support);
  const missing = [...live.filter((r) => !r.support && starred(r)), ...live.filter((r) => !r.support && !starred(r))];
  const removed = rows.filter((r) => r.removed);
  const used = rows.filter((r) => r.used);
  const missingKey = missing.map((r) => r.term).join("|");

  // The questions for the missing keywords; asked again when the missing list changes (a remove, a restore, an add).
  useEffect(() => {
    if (locked || !missingKey) return;
    let gone = false;
    api<Out>(`/api/apply/${d.id}/interview`, { method: "POST", json: { action: "questions" } })
      .then((o) => !gone && setQuestions(o.questions))
      .catch(() => !gone && setQuestions([]));
    return () => {
      gone = true;
    };
  }, [d.id, locked, missingKey]);

  const send = async (key: string, json: Record<string, unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await api(`/api/apply/${d.id}/keywords`, { method: "POST", json });
      await reload();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const open = questions?.length ?? 0;

  const item = (r: KeywordRow) => (
    <li key={r.term} style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 44, borderTop: `1px solid ${color.border}` }}>
      <TapTip tip={keywordTip(r)} style={{ ...body, flex: 1, minHeight: 44, textAlign: "left", border: 0, background: "transparent", padding: "8px 4px", color: color.ink, cursor: "pointer", textDecoration: r.removed ? "line-through" : "none" }} openStyle={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
        {starred(r) && !r.support && !r.removed && (
          <span style={{ color: color.brick }}>
            <span aria-hidden>★ </span>
            <span className="sr-only">Starred: </span>
          </span>
        )}
        {r.term}
        {r.mine && <span style={{ color: color.t2 }}> (yours)</span>}
      </TapTip>
      {!locked &&
        (r.removed ? (
          <button onClick={() => send(r.term, { action: "restore", term: r.term })} disabled={!!busy} style={{ ...btn("text"), height: 44, fontSize: font.lg }}>
            Put back
          </button>
        ) : (
          <button onClick={() => send(r.term, { action: "remove", term: r.term })} disabled={!!busy} aria-label={`Not relevant: ${r.term}`} data-tip="Not relevant" className="h-soft" style={{ width: 44, height: 44, flex: "none", border: 0, borderRadius: 999, background: "transparent", color: color.t2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ))}
    </li>
  );
  const column = (title: string, list: KeywordRow[], empty: string, top?: React.ReactNode) => (
    <section aria-label={title} className={title === "Missing" ? "kw-missing" : undefined} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: font.lg, fontWeight: 700 }}>
        {title} <span style={{ color: color.t2, fontWeight: 600 }}>({list.length})</span>
      </h3>
      {top}
      {list.length ? <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{list.map(item)}</ul> : <div style={muted}>{empty}</div>}
    </section>
  );

  return (
    <div id="keywords" className="kw-panel" style={{ scrollMarginTop: 80, ...card, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: font.xl, fontWeight: 700 }}>Keywords</div>
      {d.keywordsApproved && <div style={muted}>Approved. The resume below uses them.</div>}
      <div className="kw-cols">
        {column("In your resume", backed, "None yet.")}
        {column(
          "Missing",
          missing,
          "Nothing missing.",
          !locked && missing.length > 0 && questions?.length !== 0 && (
            <button onClick={() => setAsking(true)} disabled={questions === null} style={{ ...btn("solid"), height: 44, fontSize: font.lg, alignSelf: "flex-start", opacity: questions === null ? 0.6 : 1 }}>
              {questions === null ? "Getting questions ready…" : `Answer ${plural(open, "question")}`}
            </button>
          ),
        )}
      </div>
      {removed.length > 0 && (
        <details>
          <summary style={{ ...body, cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>Not relevant ({removed.length})</summary>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{removed.map(item)}</ul>
        </details>
      )}
      {!locked && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (term.trim() && (await send("__add", { action: "add", term: term.trim() }))) setTerm("");
          }}
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          <label htmlFor="kw-add" style={{ ...body, fontWeight: 600 }}>
            Add your own keyword
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input id="kw-add" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={80} placeholder="e.g. design systems" style={{ height: 44, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 12px", fontSize: font.lg, flex: "1 1 200px", minWidth: 0 }} />
            <button type="submit" disabled={!!busy || !term.trim()} style={{ ...btn("outline"), height: 44, fontSize: font.lg }}>
              Add
            </button>
          </div>
        </form>
      )}
      {!locked && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12, borderTop: `1px solid ${color.border}` }}>
          <div style={body}>
            <span style={{ fontWeight: 600 }}>Final list ({used.length}): </span>
            {used.map((r) => r.term).join(", ") || "none yet"}
          </div>
          {!d.keywordsApproved && (
            <button onClick={() => send("__approve", { action: "approve" })} disabled={!!busy || !used.length} style={{ ...btn("solid"), height: 44, fontSize: font.lg, alignSelf: "flex-start" }}>
              {busy === "__approve" ? "Writing the resume…" : "Use these keywords"}
            </button>
          )}
        </div>
      )}
      {err && (
        <div role="alert" style={{ ...body, color: color.brick }}>
          {err}
        </div>
      )}
      {asking && questions && (
        <KeywordInterview
          appId={d.id}
          questions={questions}
          close={() => setAsking(false)}
          onChange={(o) => {
            setQuestions(o.questions);
            void reload();
          }}
        />
      )}
    </div>
  );
}
