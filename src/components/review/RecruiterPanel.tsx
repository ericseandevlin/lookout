"use client";

import { useState } from "react";
import { DIMENSION_LABEL, DIMENSIONS, recruiterChecks, type Finding, type RecruiterAnalysis } from "@/lib/application/recruiter";
import { btn } from "../Settings";
import { muted } from "./shared";
import { color } from "@/lib/tokens";

const SHOWN = 3;

/**
 * Recruiter Analysis (#152), cut down to what the person acts on (#738): the score, one sentence,
 * and a short list. Each finding is one line with one action: Fix it when Lookout has what it
 * needs, or one short question when only the person has the fact. The why and the quoted line open
 * on a click.
 */
export function RecruiterPanel({ kind, text, analysis, locked, busy, onAnalyze, onFix }: { kind: string; text: string; analysis?: RecruiterAnalysis; locked: boolean; busy: string | null; onAnalyze: () => void; onFix: (instruction: string) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const [scores, setScores] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const findings = analysis?.findings ?? recruiterChecks(kind, text);
  const list = all ? findings : findings.slice(0, SHOWN);
  const ready = findings.filter((f) => !f.ask);
  const label = kind === "resume" ? "resume" : "cover letter";
  const tone = (n: number) => (n >= 75 ? color.greenText : n >= 50 ? "#7A5A12" : color.brick);
  const answer = (f: Finding, i: number) => {
    const a = answers[i]?.trim();
    if (a) onFix(`${f.fix}\nThe fact from me: ${a}`);
  };

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${color.border}`, background: "#FBFAF7", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Recruiter Analysis</span>
        {analysis ? (
          <button onClick={() => setScores((s) => !s)} aria-expanded={scores} data-tip="Show the five scores" style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 700, color: tone(analysis.overall) }}>
            {analysis.overall}/100
          </button>
        ) : (
          <span style={muted}>{findings.length ? `${findings.length} quick check${findings.length === 1 ? "" : "s"} to fix` : "The quick checks found nothing"}</span>
        )}
        {!locked && (
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {ready.length > 1 && (
              <button onClick={() => onFix(ready.map((f, i) => `${i + 1}. ${f.fix}`).join("\n"))} disabled={!!busy} style={{ ...btn("outline"), height: 32 }}>
                {busy === "revise" ? "Fixing…" : `Fix all ${ready.length}`}
              </button>
            )}
            <button onClick={onAnalyze} disabled={!!busy || !text.trim()} data-tip={`Reads your ${label} against the posting, the way a recruiter does in the first 10 seconds`} style={{ ...btn(analysis ? "text" : "outline"), height: 32 }}>
              {busy === "analyze" ? "Reading…" : analysis ? "Run again" : "Score it"}
            </button>
          </span>
        )}
      </div>
      {analysis?.verdict && <div style={{ fontSize: 14 }}>{analysis.verdict}</div>}
      {analysis && scores && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 6 }}>
          {DIMENSIONS.map((k) => (
            <li key={k} style={{ fontSize: 13, display: "flex", justifyContent: "space-between", gap: 6, padding: "4px 8px", borderRadius: 8, background: "#fff", border: "1px solid #EEE8E0" }}>
              <span>{DIMENSION_LABEL[k]}</span>
              <strong>{analysis.scores[k]}/10</strong>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {list.map((f, i) => (
            <li key={i} style={{ fontSize: 14, padding: "8px 10px", borderRadius: 10, background: "#fff", border: "1px solid #EEE8E0", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} style={{ flex: 1, minWidth: 0, textAlign: "left", border: 0, background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 600, color: color.ink }}>
                  <span aria-hidden style={{ color: color.t2 }}>{open === i ? "▾ " : "▸ "}</span>
                  {f.what}
                </button>
                {!locked && !f.ask && (
                  <button onClick={() => onFix(f.fix)} disabled={!!busy} style={{ ...btn("outline"), height: 30, flex: "none" }}>
                    Fix it
                  </button>
                )}
              </div>
              {!locked && f.ask && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    answer(f, i);
                  }}
                  style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                >
                  <input aria-label={f.ask} value={answers[i] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))} maxLength={600} placeholder={f.ask} style={{ flex: "1 1 240px", height: 34, borderRadius: 8, border: `1.5px solid ${color.border}`, padding: "0 10px", fontSize: 14, fontFamily: "inherit" }} />
                  <button type="submit" disabled={!!busy || !answers[i]?.trim()} style={{ ...btn("outline"), height: 34 }}>
                    Add it
                  </button>
                </form>
              )}
              {open === i && (
                <div style={{ ...muted, fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div>
                    {DIMENSION_LABEL[f.dim]}. {f.why}
                  </div>
                  {f.line && <blockquote style={{ margin: 0, padding: "2px 10px", borderLeft: `3px solid ${color.border}`, color: "#4A443A" }}>{f.line}</blockquote>}
                  <div>What Lookout will do: {f.fix}</div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {findings.length > SHOWN && (
        <button onClick={() => setAll((a) => !a)} style={{ ...btn("text"), alignSelf: "flex-start", padding: 0 }}>
          {all ? "Show fewer" : `Show ${findings.length - SHOWN} more`}
        </button>
      )}
    </div>
  );
}
