"use client";

import { useState } from "react";
import { DIMENSION_LABEL, DIMENSIONS, recruiterChecks, type Finding, type RecruiterAnalysis } from "@/lib/application/recruiter";
import { btn } from "../Settings";
import { muted } from "./shared";
import { color } from "@/lib/tokens";

/**
 * Recruiter Analysis (#152): the code-held checks show as you edit; the scored analysis is one click
 * and is kept for the version it read. Each finding quotes its line and has a Fix that revises it.
 */
export function RecruiterPanel({ kind, text, analysis, locked, busy, onAnalyze, onFix }: { kind: string; text: string; analysis?: RecruiterAnalysis; locked: boolean; busy: string | null; onAnalyze: () => void; onFix: (f: Finding) => void }) {
  const [open, setOpen] = useState(false);
  const findings = analysis?.findings ?? recruiterChecks(kind, text);
  const label = kind === "resume" ? "resume" : "cover letter";
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${color.border}`, background: "#FBFAF7", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ ...btn("text"), padding: 0, fontWeight: 600, color: color.ink }}>
          {open ? "▾" : "▸"} Recruiter Analysis
        </button>
        {analysis ? (
          <span style={{ fontSize: 14, fontWeight: 700, color: analysis.overall >= 75 ? color.greenText : analysis.overall >= 50 ? "#7A5A12" : color.brick }}>{analysis.overall}/100</span>
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
                  {f.line && <blockquote style={{ margin: "4px 0", padding: "2px 10px", borderLeft: `3px solid ${color.border}`, color: "#4A443A", fontSize: 13 }}>{f.line}</blockquote>}
                  {!locked && (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ ...muted, fontSize: 13, flex: "1 1 240px" }}>Fix: {f.fix}</span>
                      <button onClick={() => onFix(f)} disabled={!!busy} style={{ ...btn("outline"), height: 30 }}>
                        Fix it
                      </button>
                    </div>
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
