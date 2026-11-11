"use client";

import Link from "next/link";
import { useState } from "react";
import type { KeywordRow } from "@/lib/application/evidence";
import { btn } from "../Settings";
import { api } from "../store";
import { card, muted, type Detail } from "./shared";
import { color } from "@/lib/tokens";

const GREEN = { border: "#CFE3C6", bg: "#E3EFDD" };
const RED = { border: "#E8B4AA", bg: "#FBEDEA" };
const input: React.CSSProperties = { borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 10px", fontSize: 15, height: 40, fontFamily: "inherit" };

/**
 * Keywords for the resume (#121), built to take little typing (#738): one card says how it works,
 * each keyword is a pill (green goes in, red stays out), the detail opens on a click, and Lookout
 * names the few red ones worth a line of the person's time.
 */
export function KeywordReport({ d, rows, reload, locked }: { d: Detail; rows: KeywordRow[]; reload: () => Promise<unknown>; locked: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [story, setStory] = useState("");
  const [quick, setQuick] = useState<Record<string, string>>({});
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const used = rows.filter((r) => r.used);
  const out = rows.filter((r) => !r.removed && !r.support);
  const k = d.report.keywords ?? [];
  const picks = locked ? [] : (d.keywordPicks ?? []).map((t) => rows.find((r) => r.term === t)).filter((r): r is KeywordRow => !!r);
  const sel = rows.find((r) => r.term === open);

  const send = async (key: string, json: Record<string, unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await api(`/api/apply/${d.id}/keywords`, { method: "POST", json });
      await reload();
      setOpen(null);
      setStory("");
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const add = async () => {
    if (await send("__add", { action: "add", term: term.trim() })) setTerm("");
  };
  const pick = (r: KeywordRow) => {
    setOpen(open === r.term ? null : r.term);
    setStory(r.support?.from === "notes" ? r.support.line : "");
  };
  const why = (r: KeywordRow) => (r.seen > 0 ? `${r.seen} of your other applications ask for it too` : "The posting leans on it");

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Keywords for this resume</div>

      <div style={{ padding: "10px 14px", borderRadius: 12, background: "#FBFAF7", border: `1px solid ${color.border}`, fontSize: 14, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600 }}>How this works</div>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          <li>
            <strong style={{ color: color.greenText }}>Green</strong> goes in the resume. Your resume or your experience notes already show it.
          </li>
          <li>
            <strong style={{ color: color.brick }}>Red</strong> stays out. Nothing you wrote shows it. Add one line about where you did it and it turns green.
          </li>
          <li>A line you add is saved to your experience notes. Lookout uses it again on every later application.</li>
          <li>Click a keyword to see the posting line and your line.</li>
        </ul>
      </div>

      {d.keywordsApproved && (
        <div style={muted}>
          You approved these {used.length} keywords and the resume below uses them. Change the list and you&apos;ll be asked again.
          {k.length > 0 && ` Keyword match ${k.filter((x) => x.before).length}/${k.length} → ${k.filter((x) => x.after).length}/${k.length}.`}
        </div>
      )}

      {!locked && out.length > 0 && (
        <div style={{ padding: "10px 14px", borderRadius: 12, border: `1.5px solid ${color.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {picks.length ? (
            <>
              <div style={{ fontSize: 14 }}>
                <strong>Worth one line each ({picks.length}).</strong> <span style={muted}>Skip the other red ones. Skip these too if you haven&apos;t done them.</span>
              </div>
              {picks.map((r) => (
                <form
                  key={r.term}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const s = quick[r.term]?.trim();
                    if (s) send(r.term, { action: "experience", term: r.term, story: s });
                  }}
                  style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
                >
                  <label htmlFor={`kq-${r.term}`} style={{ flex: "0 1 220px", minWidth: 140, fontSize: 14 }}>
                    <strong>{r.term}</strong>
                    <br />
                    <span style={{ ...muted, fontSize: 13 }}>{why(r)}</span>
                  </label>
                  <input id={`kq-${r.term}`} value={quick[r.term] ?? ""} onChange={(e) => setQuick((q) => ({ ...q, [r.term]: e.target.value }))} maxLength={1500} placeholder="Where you did this, in one line" style={{ ...input, flex: "1 1 240px" }} />
                  <button type="submit" disabled={!!busy || !quick[r.term]?.trim()} style={btn("outline")}>
                    {busy === r.term ? "Saving…" : "Save"}
                  </button>
                </form>
              ))}
            </>
          ) : (
            <div style={{ fontSize: 14 }}>
              <strong>Nothing to add.</strong> <span style={muted}>None of the red keywords carries enough weight in this posting to be worth your typing.</span>
            </div>
          )}
        </div>
      )}

      <ul aria-label="Keywords" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {rows.map((r) => {
          const c = r.removed ? { border: color.border, bg: color.surface } : r.support ? GREEN : RED;
          const state = r.removed ? "left out by you" : r.support ? "in the resume" : "not in the resume";
          return (
            <li key={r.term}>
              <button
                onClick={() => pick(r)}
                aria-expanded={open === r.term}
                aria-label={`${r.term}: ${state}`}
                style={{ height: 32, padding: "0 12px", borderRadius: 16, border: `1.5px solid ${open === r.term ? color.ink : c.border}`, background: c.bg, fontSize: 14, fontWeight: 600, cursor: "pointer", color: r.removed ? color.t2 : r.support ? color.greenText : color.brick, textDecoration: r.removed ? "line-through" : "none" }}
              >
                <span aria-hidden>{r.removed ? "" : r.support ? "✓ " : "+ "}</span>
                {r.term}
              </button>
            </li>
          );
        })}
      </ul>

      {sel && (
        <div style={{ padding: 12, borderRadius: 12, border: `1.5px solid ${color.ink}`, display: "flex", flexDirection: "column", gap: 6, fontSize: 14, lineHeight: 1.45 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ fontSize: 15 }}>{sel.term}</strong>
            <span style={muted}>{sel.removed ? "left out by you" : sel.support ? "in the resume" : "not in the resume"}{sel.mine ? " · added by you" : ""}</span>
            <button onClick={() => setOpen(null)} aria-label="Close" style={{ ...btn("text"), marginLeft: "auto" }}>
              ×
            </button>
          </div>
          <div>
            <span style={{ fontWeight: 600 }}>Posting: </span>
            {sel.snippet ? `“${sel.snippet}”` : <span style={muted}>{sel.mine ? "You added this one." : "Not found in the posting text."}</span>}
          </div>
          {sel.support && (
            <div>
              <span style={{ fontWeight: 600 }}>Your line: </span>
              {`“${sel.support.line}”`} <span style={muted}>({sel.support.from === "notes" ? "your experience notes" : "your master resume"})</span>
            </div>
          )}
          {!locked && !sel.removed && sel.support?.from === "resume" && (
            <div style={{ ...muted, fontSize: 13 }}>
              To change this line, edit your master resume on <Link href="/profile/materials">Materials</Link>.
            </div>
          )}
          {!locked && !sel.removed && (!sel.support || sel.support.from === "notes") && (
            <>
              <label htmlFor="kw-story" style={{ fontWeight: 600 }}>
                {sel.support ? "Edit your line" : `Where have you done “${sel.term}”?`}
              </label>
              <textarea id="kw-story" value={story} onChange={(e) => setStory(e.target.value)} rows={2} maxLength={1500} placeholder="A role, a project or a result. One line is enough." style={{ borderRadius: 10, border: `1.5px solid ${color.border}`, padding: 10, fontSize: 15, fontFamily: "inherit", resize: "vertical" }} />
            </>
          )}
          {!locked && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!sel.removed && (!sel.support || sel.support.from === "notes") && (
                <button onClick={() => send(sel.term, { action: "experience", term: sel.term, story: story.trim() })} disabled={!!busy || !story.trim() || story.trim() === sel.support?.line} style={btn("solid")}>
                  {busy === sel.term ? "Saving…" : "Save"}
                </button>
              )}
              {/* Red keywords are out already, so only a green one, or one the person added, can be taken out. */}
              {sel.removed ? (
                <button onClick={() => send(sel.term, { action: "restore", term: sel.term })} disabled={!!busy} style={btn("outline")}>
                  Put back
                </button>
              ) : sel.support || sel.mine ? (
                <button onClick={() => send(sel.term, { action: sel.support ? "remove" : "restore", term: sel.term })} disabled={!!busy} style={btn("text")}>
                  {sel.support ? "Leave out of this resume" : "Delete"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}

      {!locked && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (term.trim()) add();
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
        >
          <label htmlFor="kw-add" style={{ fontSize: 14, fontWeight: 600 }}>
            Add your own keyword
          </label>
          <input id="kw-add" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={80} placeholder="e.g. design systems" style={{ ...input, flex: "1 1 200px" }} />
          <button type="submit" disabled={!!busy || !term.trim()} style={btn("outline")}>
            Add
          </button>
        </form>
      )}
      {!locked && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", paddingTop: 10, borderTop: `1px solid ${color.border}` }}>
          <div style={{ fontSize: 14, flex: "1 1 200px" }}>
            <strong>{used.length} in the resume</strong>
            <span style={muted}>{out.length ? ` · ${out.length} stay out` : ""}</span>
          </div>
          {!d.keywordsApproved && (
            <button onClick={() => send("__approve", { action: "approve" })} disabled={!!busy || !used.length} style={btn("solid")}>
              {busy === "__approve" ? "Writing the resume…" : "Use these keywords"}
            </button>
          )}
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 14, color: color.brick }}>{err}</div>}
    </div>
  );
}
