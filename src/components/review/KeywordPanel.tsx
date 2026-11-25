"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { KeywordRow } from "@/lib/application/evidence";
import { InfoIcon } from "../chat";
import { PlusIcon } from "../icons";
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

/**
 * Keywords for this resume (#1485): what the resume already backs, what's missing, and one way to back the missing
 * ones, the interview, which asks about them first. Each keyword has one control, x for not relevant; its posting
 * quote is a tooltip.
 */
export function KeywordPanel({ d, rows, reload, locked }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const picks = d.keywordPicks ?? [];
  const starred = (r: KeywordRow) => picks.some((p) => lower(p) === lower(r.term));
  const live = rows.filter((r) => !r.removed);
  const backed = live.filter((r) => r.support);
  const missing = [...live.filter((r) => !r.support && starred(r)), ...live.filter((r) => !r.support && !starred(r))];
  const removed = rows.filter((r) => r.removed);
  const used = rows.filter((r) => r.used);
  const [adding, setAdding] = useState(false);
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
  const heading = (title: string, n: number, extra?: React.ReactNode) => (
    <h3 style={{ margin: 0, minHeight: 36, display: "flex", alignItems: "center", gap: 8, fontSize: font.lg, fontWeight: 700 }}>
      <span style={{ flex: 1 }}>
        {title}&nbsp;<span style={{ color: color.t2, fontWeight: 600 }}>({n})</span>
      </span>
      {extra}
    </h3>
  );
  const list = (xs: KeywordRow[], empty: string) => (xs.length ? <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{xs.map(item)}</ul> : <div style={muted}>{empty}</div>);

  // Missing on the left, outside the card: it isn't used. The card on the right is what goes in, down to its go (#1665).
  return (
    <div id="keywords" className="kw-panel" style={{ scrollMarginTop: 80, ...card, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, fontSize: font.xl, fontWeight: 700 }}>Keywords</div>
        {!locked && <AddKeyword open={adding} setOpen={setAdding} busy={!!busy} onAdd={(t) => send("__add", { action: "add", term: t })} />}
      </div>
      <div className="kw-cols">
        <section aria-label="Missing" className="kw-missing" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, padding: "14px 0" }}>
          {heading(
            "Missing",
            missing.length,
            // One interview, not two: the interview page asks about these first, and a backed one moves over (#1485).
            // Secondary: the resume can go ahead with what's already backed (#1665).
            !locked && missing.length > 0 && (
              <Link href={`/interview?app=${d.id}`} data-tip="A short interview adds missing keywords." style={{ ...btn("outline"), height: 36, padding: "0 14px", fontSize: font.base, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                Interview me
              </Link>
            ),
          )}
          {list(missing, "Nothing missing.")}
        </section>
        <section aria-label="In your resume" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, padding: 14, borderRadius: 12, background: "#FAF8F4", border: `1px solid ${color.border}` }}>
          {heading("In your resume", backed.length)}
          {list(backed, "None yet.")}
          {d.keywordsApproved ? (
            <div style={{ ...muted, textAlign: "right" }}>Approved. The resume below uses them.</div>
          ) : (
            !locked && (
              <button onClick={() => send("__approve", { action: "approve" })} disabled={!!busy || !used.length} style={{ ...btn("solid"), height: 44, fontSize: font.lg, alignSelf: "flex-end" }}>
                {busy === "__approve" ? "Writing the resume…" : "Use these keywords"}
              </button>
            )
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

/** Add your own keyword (#1665): a + icon that opens a small box. Escape or a click outside closes it. */
function AddKeyword({ open, setOpen, busy, onAdd }: { open: boolean; setOpen: (o: boolean) => void; busy: boolean; onAdd: (term: string) => Promise<boolean> }) {
  const [term, setTerm] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, setOpen]);
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Add your own keyword" data-tip={open ? undefined : "Add your own keyword"} className="h-soft" style={{ width: 40, height: 40, border: 0, borderRadius: 999, background: "transparent", color: color.ink, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
        <PlusIcon size={18} />
      </button>
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (term.trim() && (await onAdd(term.trim()))) {
              setTerm("");
              setOpen(false);
            }
          }}
          style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, width: "min(320px, 80vw)", padding: 12, borderRadius: 12, background: "#fff", border: `1px solid ${color.border}`, boxShadow: "0 8px 24px rgba(29,26,15,.16)", display: "flex", gap: 8 }}
        >
          <label htmlFor="kw-add" className="sr-only">
            Your keyword
          </label>
          <input ref={input} id="kw-add" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={80} placeholder="e.g. design systems" style={{ height: 40, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 10px", fontSize: font.md, flex: 1, minWidth: 0 }} />
          <button type="submit" disabled={busy || !term.trim()} style={{ ...btn("outline"), height: 40 }}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}
