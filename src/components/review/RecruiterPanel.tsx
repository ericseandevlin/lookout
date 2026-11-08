"use client";

import { useState } from "react";
import { DIMENSION_LABEL, DIMENSIONS, recruiterChecks, type Finding, type RecruiterAnalysis } from "@/lib/application/recruiter";
import { btn } from "../Settings";
import { muted, type ActResult } from "./shared";
import { color } from "@/lib/tokens";

/**
 * Recruiter Analysis (#152): the code-held checks show as you edit; the scored analysis is one click
 * and is kept for the version it read. Each finding quotes its line and has a Fix that revises it.
 */
export function RecruiterPanel({ kind, text, analysis, locked, busy, onAnalyze, onFix }: { kind: string; text: string; analysis?: RecruiterAnalysis; locked: boolean; busy: string | null; onAnalyze: () => void; onFix: (instruction: string) => Promise<ActResult> }) {
  const [open, setOpen] = useState(false);
  // Inline Fix it (#512): which finding is running, and a question Lookout asked back (or one we ask first).
  const [fixing, setFixing] = useState<number | null>(null);
  const [asked, setAsked] = useState<{ i: number; question: string; answer: string } | null>(null);
  const fix = async (i: number, f: Finding, answer?: string) => {
    setFixing(i);
    const r = await onFix(answer ? `${f.fix}\n\nMy answer: ${answer}` : f.fix);
    setFixing(null);
    setAsked(r && r.question ? { i, question: r.question, answer: "" } : null);
  };
  // A fix that needs a number I may not have given asks for it first, instead of a round trip that ends in a question.
  const needsNumber = (f: Finding) => /ask me for/i.test(f.fix);
  const findings = analysis?.findings ?? recruiterChecks(kind, text);
  const label = kind === "resume" ? "resume" : "cover letter";
  return (
    <div style={{ borderRadius: 12, border: "1px solid #E6E0D8", background: "#FBFAF7", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ ...btn("text"), padding: 0, fontWeight: 600, color: color.ink }}>
          {open ? "▾" : "▸"} Recruiter Analysis
        </button>
        {analysis ? (
          <span style={{ fontSize: 14, fontWeight: 700, color: analysis.overall >= 75 ? "#35662A" : analysis.overall >= 50 ? "#7A5A12" : color.brick }}>{analysis.overall}/100</span>
        ) : (
          <span style={muted}>{findings.length ? `${findings.length} thing${findings.length === 1 ? "" : "s"} a recruiter would notice` : "Nothing flagged by the quick checks"}</span>
        )}
        {!locked && (
          <button onClick={() => { setOpen(true); onAnalyze(); }} disabled={!!busy || !text.trim()} style={{ ...btn("outline"), height: 32, marginLeft: "auto" }}>
            {busy === "analyze" ? "Reading…" : analysis ? "Run again" : "Score it"}
          </button>
        )}
      </div>
      {open && (
        <>
          {analysis ? (
            <>
              {analysis.verdict && <div style={{ fontSize: 14 }}>{analysis.verdict}</div>}
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 6 }}>
                {DIMENSIONS.map((k) => (
                  <li key={k} style={{ fontSize: 13, display: "flex", justifyContent: "space-between", gap: 6, padding: "4px 8px", borderRadius: 8, background: "#fff", border: "1px solid #EEE8E0" }}>
                    <span>{DIMENSION_LABEL[k]}</span>
                    <strong>{analysis.scores[k]}/10</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div style={muted}>Quick checks run as you edit. Score it for a full read against the posting, the way a recruiter reads your {label} in the first 10 seconds.</div>
          )}
          {findings.length > 0 && (
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
              {findings.map((f, i) => (
                <li key={i} style={{ fontSize: 14 }}>
                  <div>
                    <span style={{ ...muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>{DIMENSION_LABEL[f.dim]}</span>
                    <br />
                    <strong>{f.what}</strong> {f.why}
                  </div>
                  {f.line && <blockquote style={{ margin: "4px 0", padding: "2px 10px", borderLeft: "3px solid #E0D9CF", color: "#4A443A", fontSize: 13 }}>{f.line}</blockquote>}
                  {!locked && (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ ...muted, fontSize: 13, flex: "1 1 240px" }}>Fix: {f.fix}</span>
                      <button
                        onClick={() => (needsNumber(f) ? setAsked({ i, question: "What number goes on this line? Team size, users, revenue, money or time saved. Only what's true.", answer: "" }) : fix(i, f))}
                        disabled={!!busy || asked?.i === i}
                        style={{ ...btn("outline"), height: 30 }}
                      >
                        {fixing === i ? "Working…" : needsNumber(f) ? "Add a number" : "Fix it"}
                      </button>
                    </div>
                  )}
                  {!locked && asked?.i === i && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (asked.answer.trim()) fix(i, f, asked.answer.trim());
                      }}
                      style={{ marginTop: 6, padding: "10px 12px", borderRadius: 10, background: "#FFF9F3", border: `1px solid ${color.orange}`, display: "flex", flexDirection: "column", gap: 8 }}
                    >
                      <label htmlFor={`fix-${kind}-${i}`} style={{ fontSize: 14, fontWeight: 600 }}>
                        {asked.question}
                      </label>
                      <textarea
                        id={`fix-${kind}-${i}`}
                        autoFocus
                        rows={2}
                        value={asked.answer}
                        onChange={(e) => setAsked({ ...asked, answer: e.target.value })}
                        style={{ borderRadius: 8, border: "1.5px solid #E0D9CF", padding: 8, fontSize: 14, fontFamily: "inherit", resize: "vertical" }}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="submit" disabled={!!busy || !asked.answer.trim()} style={{ ...btn("solid"), height: 32 }}>
                          {fixing === i ? "Working…" : "Fix it with this"}
                        </button>
                        <button type="button" onClick={() => setAsked(null)} style={{ ...btn("text"), height: 32 }}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
