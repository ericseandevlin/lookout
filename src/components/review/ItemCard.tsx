"use client";

import { useState } from "react";
import type { Template } from "@/lib/application/resumeLayout";
import type { RecruiterAnalysis } from "@/lib/application/recruiter";
import { btn } from "../Settings";
import { DocPreview } from "./DocPreview";
import { InfoTip } from "./InfoTip";
import { RecruiterPanel } from "./RecruiterPanel";
import { TemplatePicker } from "./TemplatePicker";
import { VersionNotes } from "./VersionNotes";
import { card, muted, type Act, type Item } from "./shared";
import { color } from "@/lib/tokens";

export function ItemCard({ appId, item, locked, act, analysis, template, accent, header, onTemplate, onAccent }: { appId: string; item: Item; locked: boolean; act: Act; analysis?: RecruiterAnalysis; template: Template; accent: string | null; header: { name: string; contact: string; headline?: string } | null; onTemplate: (t: Template) => void; onAccent: (hex: string) => void }) {
  const latest = item.versions[0];
  const [pick, setPick] = useState<string | null>(null);
  const shown = item.versions.find((v) => v.id === pick) ?? item.versions.find((v) => v.id === item.approvedVersionId) ?? latest;
  const [text, setText] = useState(shown?.content ?? "");
  const [instr, setInstr] = useState("");
  const [busy, setBusy] = useState<null | "save" | "revise" | "approve" | "analyze">(null);
  // Reset the editor when the shown version changes (a pick, or a new version from the server).
  const key = `${shown?.id}:${shown?.content}`;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setText(shown?.content ?? "");
  }

  const outreach = item.kind === "outreach";
  const isApproved = !outreach && !!shown && shown.id === item.approvedVersionId;
  const dirty = text !== (shown?.content ?? "");
  const doc = item.kind === "resume" || item.kind === "cover_letter";
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const long = doc || outreach || (item.fieldType === "textarea" && item.kind !== "field");
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const run = async (kind: NonNullable<typeof busy>, payload: Record<string, unknown>, done: string) => {
    setBusy(kind);
    const r = await act(item.id, payload, done);
    if (r && kind !== "approve") setPick(null);
    if (r && kind === "revise") setInstr("");
    setBusy(null);
    return r;
  };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, borderColor: isApproved ? "#9CC68E" : color.border }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <label htmlFor={`it-${item.id}`} style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600 }}>
          {item.prompt}
          {item.required ? <span style={{ color: color.brick }}> *</span> : !outreach && <span style={{ ...muted, fontWeight: 400 }}> (optional)</span>}
        </label>
        {isApproved && <span style={{ fontSize: 14, fontWeight: 600, color: color.greenText }}>{item.kind === "field" ? "✓ Will be filled" : `✓ Approved v${shown.version}`}</span>}
      </div>

      {item.salary && item.salary.amount === null && !locked && (
        <div style={{ padding: "8px 12px", borderRadius: 10, background: "#FBF4E6", border: "1px solid #E8D3A6", fontSize: 14, color: "#5C4613" }}>
          <strong>No suggested ask.</strong> {item.salary.note}
        </div>
      )}
      {item.salary?.amount && !locked && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", borderRadius: 10, background: "#F3F7F1", border: "1px solid #CFE3C6" }}>
          <span style={{ fontSize: 14, color: color.greenText }}>Suggested ask</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: color.ink }}>{item.salary.amount}</span>
          <InfoTip label="How this is calculated" text={item.salary.note} />
          {text.replace(/[^\d]/g, "") !== item.salary.amount.replace(/[^\d]/g, "") && (
            <button onClick={() => run("save", { action: "edit", content: item.salary!.amount!, note: "Used Lookout's suggested ask." }, "Saved the suggested ask as a new version.")} disabled={!!busy} style={{ ...btn("outline"), height: 32, marginLeft: "auto" }}>
              Use it
            </button>
          )}
        </div>
      )}
      {doc && !editing ? (
        <>
          {!locked && <TemplatePicker value={template} accent={accent} onPick={onTemplate} onAccent={onAccent} />}
          <DocPreview md={text} template={template} accent={accent} header={header} />
        </>
      ) : item.options?.length && !locked ? (
        <select id={`it-${item.id}`} value={text} onChange={(e) => setText(e.target.value)} style={{ height: 40, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 10px", fontSize: 15, maxWidth: 420 }}>
          <option value="">Choose…</option>
          {item.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <textarea
          id={`it-${item.id}`}
          value={text}
          readOnly={locked}
          onChange={(e) => setText(e.target.value)}
          rows={long ? (item.kind === "resume" ? 18 : 8) : 1}
          style={{ borderRadius: 10, border: `1.5px solid ${color.border}`, padding: 10, fontSize: 15, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical", background: locked ? "#FAF8F5" : "#fff" }}
        />
      )}

      {shown && <VersionNotes v={shown} />}

      {doc && shown && !editing && (
        <RecruiterPanel
          kind={item.kind}
          text={text}
          analysis={analysis?.versionId === shown.id && !dirty ? analysis : undefined}
          locked={locked}
          busy={busy}
          onAnalyze={() => run("analyze", { action: "analyze", versionId: shown.id }, "Recruiter Analysis is ready.")}
          onFix={(instruction) => run("revise", { action: "revise", instruction }, "Lookout made a new version with that fix.")}
        />
      )}

      {!locked && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {outreach && (
              <button onClick={copy} disabled={!text.trim()} style={btn("solid")}>
                {copied ? "Copied" : "Copy draft"}
              </button>
            )}
            {doc && (
              <button onClick={() => setEditing((e) => !e)} aria-pressed={editing} style={btn("outline")}>
                {editing ? "Preview" : "Edit text"}
              </button>
            )}
            {doc && !dirty && (
              <button onClick={() => run("revise", { action: "redraft" }, item.kind === "resume" ? "Lookout wrote a fresh resume from the posting." : "Lookout wrote a fresh cover letter from the posting.")} disabled={!!busy} style={btn("text")}>
                {busy === "revise" ? "Working…" : "Redraft from the posting"}
              </button>
            )}
            {doc && !dirty && (
              <a href={`/api/apply/${appId}/items/${item.id}/docx`} style={{ ...btn("text"), display: "inline-flex", alignItems: "center" }}>
                Download .docx
              </a>
            )}
            {item.versions.length > 1 && (
              <select aria-label="Version" value={shown?.id} onChange={(e) => setPick(e.target.value)} style={{ height: 38, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 8px", fontSize: 14 }}>
                {item.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version} · {v.author === "ai" ? "Lookout" : "you"}
                    {v.id === item.approvedVersionId ? " · approved" : ""}
                  </option>
                ))}
              </select>
            )}
            {dirty ? (
              <button onClick={() => run("save", { action: "edit", content: text, note: "" }, "Saved as a new version.")} disabled={!!busy} style={btn("outline")}>
                {busy === "save" ? "Saving…" : "Save as new version"}
              </button>
            ) : item.kind === "field" || outreach ? null : isApproved ? (
              <button onClick={() => run("approve", { action: "approve", versionId: null }, "Approval removed.")} disabled={!!busy} style={btn("text")}>
                Unapprove
              </button>
            ) : (
              <button onClick={() => shown && run("approve", { action: "approve", versionId: shown.id }, `Approved v${shown.version}.`)} disabled={!!busy || !shown?.content.trim()} style={btn("solid")}>
                {busy === "approve" ? "Approving…" : `Approve v${shown?.version ?? 1}`}
              </button>
            )}
          </div>
          {item.kind !== "field" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (instr.trim()) run("revise", { action: "revise", instruction: instr }, "Lookout made a new version.");
              }}
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <label htmlFor={`rv-${item.id}`} className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                Ask Lookout to revise {item.prompt}
              </label>
              <input
                id={`rv-${item.id}`}
                value={instr}
                onChange={(e) => setInstr(e.target.value)}
                placeholder={item.kind === "resume" ? "Ask Lookout: lead with the platform work, cut to one page…" : outreach ? "Ask Lookout: shorter, warmer, change the request…" : "Ask Lookout: shorter, more specific, mention…"}
                style={{ flex: "1 1 260px", height: 38, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 12px", fontSize: 14 }}
              />
              <button type="submit" disabled={!instr.trim() || !!busy} style={btn("outline")}>
                {busy === "revise" ? "Revising…" : "Revise"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
