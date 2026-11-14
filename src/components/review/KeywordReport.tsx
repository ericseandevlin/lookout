"use client";

import Link from "next/link";
import { useState } from "react";
import type { KeywordRow } from "@/lib/application/evidence";
import { btn } from "../Settings";
import { api } from "../store";
import { card, muted, type Detail } from "./shared";
import { color, font } from "@/lib/tokens";

export function KeywordReport({ d, rows, reload, locked }: { d: Detail; rows: KeywordRow[]; reload: () => Promise<unknown>; locked: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [story, setStory] = useState("");
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const used = rows.filter((r) => r.used);
  const k = d.report.keywords ?? [];

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
    if (await send("__add", { action: "add", term: term.trim(), ...(story.trim() ? { story: story.trim() } : {}) })) setTerm("");
  };
  const line: React.CSSProperties = { fontSize: font.base, lineHeight: 1.45 };

  const picks = d.keywordPicks ?? [];
  const sel = rows.find((r) => r.term === open) ?? null;
  const pick = (r: KeywordRow) => {
    setOpen(sel?.term === r.term ? null : r.term);
    setEditing(!locked && !r.removed && !r.support);
    setStory(r.support?.from === "notes" ? r.support.line : "");
  };
  const pill = (r: KeywordRow): React.CSSProperties => {
    const tone = r.removed ? { border: color.border, bg: color.surface, fg: color.t2 } : r.support ? { border: "#9CC68E", bg: "#F3F7F1", fg: color.greenText } : { border: "#E8B4AA", bg: "#FBEFEC", fg: color.brick };
    const on = sel?.term === r.term;
    return { height: 32, padding: "0 12px", borderRadius: 999, fontSize: font.base, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${on ? color.ink : tone.border}`, background: tone.bg, color: tone.fg, textDecoration: r.removed ? "line-through" : "none", boxShadow: on ? `0 0 0 1px ${color.ink}` : "none" };
  };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: font.md, fontWeight: 700 }}>Keywords for this resume</div>
      <div style={{ ...muted, lineHeight: 1.5 }}>
        {d.keywordsApproved
          ? `You approved these ${used.length} keywords and the resume below uses them. Change the list and you'll be asked again.`
          : "Green keywords are backed by your resume or notes and go in. Red ones aren't backed yet, so they stay out unless you add the experience. Click a keyword to see where the posting asks for it and what backs it. Nothing goes in until you press \u201cUse these keywords\u201d."}
        {d.keywordsApproved && k.length > 0 && ` Keyword match ${k.filter((x) => x.before).length}/${k.length} → ${k.filter((x) => x.after).length}/${k.length}.`}
      </div>
      {!locked && rows.some((r) => !r.removed && !r.support) && (
        <div style={{ fontSize: font.base }}>
          {picks.length ? (
            <>
              <span style={{ fontWeight: 600 }}>Worth adding: </span>
              {picks.map((t, i) => (
                <span key={t}>
                  {i > 0 && ", "}
                  <button onClick={() => pick(rows.find((r) => r.term === t)!)} style={{ ...btn("text"), height: "auto", padding: 0, fontSize: font.base }}>
                    {t}
                  </button>
                </span>
              ))}
              <span style={muted}> · the posting leans on {picks.length === 1 ? "this one" : "these"} and nothing backs {picks.length === 1 ? "it" : "them"} yet. Add only what you&apos;ve really done.</span>
            </>
          ) : (
            <span style={muted}>None of the red keywords stand out for this role. Add one only if you&apos;ve done the work.</span>
          )}
        </div>
      )}
      <ul aria-label="Keywords" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {rows.map((r) => (
          <li key={r.term}>
            <button onClick={() => pick(r)} aria-expanded={sel?.term === r.term} aria-label={`${r.term}: ${r.removed ? "removed" : r.support ? "in your resume" : "not backed yet"}`} style={pill(r)}>
              {r.term}
              {picks.includes(r.term) && <span aria-hidden> ★</span>}
            </button>
          </li>
        ))}
      </ul>
      {sel && (
        <div style={{ padding: 12, borderRadius: 12, border: `1.5px solid ${sel.removed ? color.border : sel.support ? "#CFE3C6" : "#E8B4AA"}`, background: "#fff", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: font.md }}>{sel.term}</span>
            <span style={{ fontSize: font.sm, fontWeight: 600, color: sel.removed ? color.t2 : sel.support ? color.greenText : color.brick }}>{sel.removed ? "removed" : sel.support ? "in your resume" : "not backed yet"}</span>
            {sel.mine && <span style={{ ...muted, fontSize: font.sm }}>added by you</span>}
            {!locked && (
              <button onClick={() => send(sel.term, { action: sel.removed ? "restore" : "remove", term: sel.term })} disabled={!!busy} style={{ ...btn("text"), marginLeft: "auto" }}>
                {sel.removed ? "Put back" : "Remove"}
              </button>
            )}
            <button onClick={() => setOpen(null)} aria-label="Close keyword detail" style={{ ...btn("text"), textDecoration: "none", padding: "0 4px", marginLeft: locked ? "auto" : 0 }}>
              ×
            </button>
          </div>
          <div style={line}>
            <span style={{ fontWeight: 600 }}>Posting: </span>
            {sel.snippet ? `\u201c${sel.snippet}\u201d` : <span style={muted}>{sel.mine ? "You added this one." : "Not found in the posting text."}</span>}
          </div>
          <div style={line}>
            <span style={{ fontWeight: 600 }}>Your experience: </span>
            {sel.support ? (
              <>
                {`\u201c${sel.support.line}\u201d`} <span style={muted}>({sel.support.from === "notes" ? "your experience notes" : "your master resume"})</span>
              </>
            ) : (
              <span style={{ color: color.brick }}>Nothing in your resume or experience notes shows this yet.</span>
            )}
          </div>
          {!locked && !sel.removed && !editing && sel.support?.from === "notes" && (
            <button onClick={() => setEditing(true)} disabled={!!busy} style={{ ...btn("text"), alignSelf: "flex-start" }}>
              Edit this line
            </button>
          )}
          {!locked && !sel.removed && sel.support?.from === "resume" && <div style={{ ...muted, fontSize: font.sm }}>To change this line, edit your master resume on <Link href="/profile/materials">Materials</Link>.</div>}
          {editing && !locked && !sel.removed && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
              <label htmlFor="kw-story" style={{ fontSize: font.base, fontWeight: 600 }}>
                Where have you done “{sel.term}”?
              </label>
              <div style={muted}>A role, a project, a result your resume leaves out. It goes into your experience notes for every later application.</div>
              <textarea id="kw-story" value={story} onChange={(e) => setStory(e.target.value)} rows={3} maxLength={1500} placeholder="e.g. I use Claude and Claude Code daily; I built a multi-agent setup that writes and ships code for my side project." style={{ borderRadius: 10, border: `1.5px solid ${color.border}`, padding: 10, fontSize: font.md, fontFamily: "inherit", resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => send(sel.term, { action: "experience", term: sel.term, story: story.trim() })} disabled={!!busy || !story.trim()} style={btn("solid")}>
                  Save
                </button>
                {sel.support && (
                  <button onClick={() => setEditing(false)} disabled={!!busy} style={btn("text")}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {!locked && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label htmlFor="kw-add" style={{ fontSize: font.base, fontWeight: 600 }}>
            Add your own keyword
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input id="kw-add" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={80} placeholder="e.g. design systems" style={{ height: 40, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 10px", fontSize: font.md, flex: "1 1 200px" }} />
            <button onClick={add} disabled={!!busy || !term.trim()} style={btn("outline")}>
              Add
            </button>
          </div>
        </div>
      )}
      {!locked && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: `1px solid ${color.border}` }}>
          <div style={{ fontSize: font.base }}>
            <span style={{ fontWeight: 600 }}>Final list ({used.length}): </span>
            {used.map((r) => r.term).join(", ") || "none yet"}
            {rows.some((r) => !r.removed && !r.support) && <span style={muted}> · red keywords stay out</span>}
          </div>
          {!d.keywordsApproved && (
            <button onClick={() => send("__approve", { action: "approve" })} disabled={!!busy || !used.length} style={{ ...btn("solid"), alignSelf: "flex-start" }}>
              {busy === "__approve" ? "Writing the resume…" : "Use these keywords"}
            </button>
          )}
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: font.base, color: color.brick }}>{err}</div>}
    </div>
  );
}
