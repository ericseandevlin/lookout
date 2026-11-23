"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { KeywordRow } from "@/lib/application/evidence";
import { InfoIcon } from "../chat";
import { btn } from "../Settings";
import { api } from "../store";
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
const lower = (s: string) => s.toLowerCase();

/** What the tooltip on a keyword says: where the posting asks for it, and what backs it. */
export function keywordTip(r: KeywordRow) {
  const asked = r.snippet ? `Posting: “${r.snippet}”` : r.mine ? "You added this one." : "Not found in the posting text.";
  return r.support ? `${asked}\nYour experience: “${r.support.line}”` : asked;
}

/** One column's title with its count. */
const title = (t: string, n: number) => (
  <h3 style={{ margin: 0, minHeight: 32, display: "flex", alignItems: "center", fontSize: font.lg, fontWeight: 700 }}>
    {t}&nbsp;<span style={{ color: color.t2, fontWeight: 600 }}>({n})</span>
  </h3>
);

/**
 * Keywords for this resume (#1485): what the resume already backs and what's missing, one way to back the missing
 * ones, the interview, which asks about them first. The In your resume card is the final list: what's in it gets
 * worked into the resume; Missing stays out (#1665). Each keyword has one control, x for not relevant; its posting
 * quote is a tooltip.
 */
export function KeywordPanel({ d, rows, reload, locked }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [adding, setAdding] = useState(false);
  const picks = d.keywordPicks ?? [];
  const starred = (r: KeywordRow) => picks.some((p) => lower(p) === lower(r.term));
  const live = rows.filter((r) => !r.removed);
  const backed = live.filter((r) => r.support);
  const missing = [...live.filter((r) => !r.support && starred(r)), ...live.filter((r) => !r.support && !starred(r))];
  const removed = rows.filter((r) => r.removed);
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

  const item = (r: KeywordRow) => (
    <li key={r.term} style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 44, borderTop: `1px solid ${color.border}` }}>
      {/* Plain text: a keyword does nothing when clicked, so it doesn't look clickable. The quiet icon shows the quote (#1485). */}
      <span style={{ ...body, flex: 1, minWidth: 0, padding: "8px 4px", color: color.ink, textDecoration: r.removed ? "line-through" : "none" }}>
        {starred(r) && !r.support && !r.removed && (
          <span style={{ color: color.brick }}>
            <span aria-hidden>★ </span>
            <span className="sr-only">Starred: </span>
          </span>
        )}
        {r.term}
        {r.mine && <span style={{ color: color.t2 }}> (yours)</span>}{" "}
        <InfoIcon tip={keywordTip(r)} label={`Where the posting asks for ${r.term}`} />
      </span>
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
  const list = (rs: KeywordRow[]) => (rs.length ? <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{rs.map(item)}</ul> : null);
  // A tap outside the add-your-own popover closes it.
  useEffect(() => {
    if (!adding) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.("[data-kw-add]")) setAdding(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [adding]);

  return (
    <div id="keywords" className="kw-panel" style={{ scrollMarginTop: 80, ...card, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: font.xl, fontWeight: 700 }}>Keywords</div>
        {/* The one score on the page (#1665): how much of this posting the person's work already backs. */}
        {live.length > 0 && (
          <span style={{ fontSize: font.base, fontWeight: 700, display: "inline-flex", alignItems: "center" }}>
            Match {backed.length}/{live.length}
            <InfoIcon tip="How many of this posting's keywords your experience already backs. A short interview about your work backs more." label="What the match is" />
          </span>
        )}
        {d.keywordsApproved && <span style={muted}>Approved. The resume below uses these.</span>}
        <span style={{ flex: 1 }} />
        {!locked && (
          <div data-kw-add="" style={{ position: "relative" }}>
            <button onClick={() => setAdding((a) => !a)} aria-expanded={adding} aria-label="Add your own keyword" data-tip="Add your own keyword" className="h-soft" style={{ width: 38, height: 38, padding: 0, border: 0, borderRadius: 999, background: "transparent", color: color.t2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            {adding && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (term.trim() && (await send("__add", { action: "add", term: term.trim() }))) {
                    setTerm("");
                    setAdding(false);
                  }
                }}
                style={{ position: "absolute", top: 44, right: 0, zIndex: 30, width: 280, padding: 12, borderRadius: 12, background: "#fff", border: `1.5px solid ${color.border}`, boxShadow: "0 8px 24px rgba(29,26,15,.14)", display: "flex", gap: 8, alignItems: "center" }}
              >
                <label htmlFor="kw-add" className="sr-only">
                  Add your own keyword
                </label>
                <input id="kw-add" autoFocus value={term} onChange={(e) => setTerm(e.target.value)} maxLength={80} placeholder="e.g. design systems" onKeyDown={(e) => e.key === "Escape" && setAdding(false)} style={{ height: 38, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 10px", fontSize: font.base, flex: 1, minWidth: 0 }} />
                <button type="submit" disabled={!!busy || !term.trim()} style={{ ...btn("solid"), height: 38 }}>
                  Add
                </button>
              </form>
            )}
          </div>
        )}
      </div>
      <div className="kw-cols">
        <section aria-label="Missing" className="kw-missing" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          {title("Missing", missing.length)}
          {list(missing) ?? <div style={muted}>Nothing missing.</div>}
          {!locked && missing.length > 0 && (
            // One interview, not two: the interview page asks about these first, and a backed one moves over (#1485).
            // Secondary (#1665): the person can go on with the keywords already in the resume.
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
              <div style={muted}>A short interview adds missing keywords.</div>
              <Link href={`/interview?app=${d.id}`} style={{ ...btn("outline"), height: 36, padding: "0 14px", fontSize: font.base, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                Interview me
              </Link>
            </div>
          )}
        </section>
        {/* The subtle card is the final list (#1665): everything in it gets worked into the resume, nothing outside it does. */}
        <section aria-label="In your resume" style={{ padding: "6px 14px 14px", borderRadius: 12, background: color.surface, border: `1px solid ${color.border}`, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          {title("In your resume", backed.length)}
          {list(backed) ?? <div style={muted}>None yet.</div>}
          {!locked && !d.keywordsApproved && (
            <button onClick={() => send("__approve", { action: "approve" })} disabled={!!busy || !backed.length} style={{ ...btn("solid"), height: 44, fontSize: font.lg, alignSelf: "flex-end" }}>
              {busy === "__approve" ? "Writing the resume…" : "Use these keywords"}
            </button>
          )}
        </section>
      </div>
      {removed.length > 0 && (
        <details>
          <summary style={{ ...body, cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>Not relevant ({removed.length})</summary>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{removed.map(item)}</ul>
        </details>
      )}
      {err && (
        <div role="alert" style={{ ...body, color: color.brick }}>
          {err}
        </div>
      )}
    </div>
  );
}
