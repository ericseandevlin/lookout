"use client";

import Link from "next/link";
import { useState } from "react";
import type { Template } from "@/lib/application/resumeLayout";
import { recruiterChecks } from "@/lib/application/recruiter";
import { InfoIcon } from "../chat";
import { btn } from "../Settings";
import { DocPreview } from "./DocPreview";
import { InfoTip } from "./InfoTip";
import { TemplatePicker } from "./TemplatePicker";
import { VersionNotes } from "./VersionNotes";
import { card, muted, OptionChecks, type Act, type Item, type LetterInfo } from "./shared";
import type { LetterStrategy } from "@/lib/application/letterStrategy";
import { color, font } from "@/lib/tokens";
import { LETTER_STRATEGIES, STRATEGY } from "@/lib/application/letterStrategy";
import { DownloadIcon, EyeIcon, PencilIcon, RedoIcon } from "../icons";

const iconBtn: React.CSSProperties = { ...btn("outline"), width: 38, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" };

/** The cover letter's top fix from the quick checks, as a request Lookout can act on, ready to send (#1665). */
export const letterFix = (kind: string, content: string) => (kind === "cover_letter" ? recruiterChecks(kind, content).find((f) => !f.needsFact)?.fix ?? "" : "");

const ASK: Record<string, string> = { resume: "Ask Lookout to update your resume", cover_letter: "Ask Lookout to update your cover letter", outreach: "Ask Lookout to update this message" };

export function ItemCard({ appId, item, locked, act, template, accent, header, letter, onTemplate, onAccent, needsKeywords = false, interviewHref = null }: { appId: string; item: Item; locked: boolean; act: Act; needsKeywords?: boolean; interviewHref?: string | null; template: Template; accent: string | null; header: { name: string; contact: string; headline?: string } | null; letter?: LetterPick | null; onTemplate: (t: Template) => void; onAccent: (hex: string) => void }) {
  const latest = item.versions[0];
  const [pick, setPick] = useState<string | null>(null);
  const shown = item.versions.find((v) => v.id === pick) ?? item.versions.find((v) => v.id === item.approvedVersionId) ?? latest;
  const [text, setText] = useState(shown?.content ?? "");
  const [instr, setInstr] = useState(() => letterFix(item.kind, shown?.content ?? ""));
  const [busy, setBusy] = useState<null | "save" | "revise" | "approve">(null);
  // Reset the editor when the shown version changes (a pick, or a new version from the server).
  const key = `${shown?.id}:${shown?.content}`;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setText(shown?.content ?? "");
    setInstr(letterFix(item.kind, shown?.content ?? ""));
  }

  const outreach = item.kind === "outreach";
  // The resume is written from approved keywords; until then the server refuses a redraft (#1334).
  const blocked = item.kind === "resume" && needsKeywords;
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
    const ok = await act(item.id, payload, done);
    if (ok && kind !== "approve") setPick(null);
    setBusy(null);
  };

  return (
    <div id={`item-${item.id}`} style={{ ...card, display: "flex", flexDirection: "column", gap: 10, scrollMarginTop: 80, borderColor: isApproved ? "#9CC68E" : color.border }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <label htmlFor={`it-${item.id}`} style={{ flex: 1, minWidth: 0, fontSize: font.md, fontWeight: 600 }}>
          {item.prompt}
          {item.required ? <span style={{ color: color.brick }}> *</span> : !outreach && <span style={{ ...muted, fontWeight: 400 }}> (optional)</span>}
        </label>
        {isApproved && <span style={{ fontSize: font.base, fontWeight: 600, color: color.greenText }}>{item.kind === "field" ? "✓ Will be filled" : `✓ Approved v${shown.version}`}</span>}
      </div>
      {blocked && !locked && (
        <div style={{ ...muted, fontSize: font.sm }}>
          <a href="#keywords" onClick={(e) => { e.preventDefault(); document.getElementById("keywords")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
            Press &ldquo;Use these keywords&rdquo;
          </a>{" "}
          to write it.
        </div>
      )}

      {item.salary && item.salary.amount === null && !locked && (
        <div style={{ padding: "8px 12px", borderRadius: 10, background: "#FBF4E6", border: "1px solid #E8D3A6", fontSize: font.base, color: "#5C4613" }}>
          <strong>No suggested ask.</strong> {item.salary.note}
        </div>
      )}
      {item.salary?.amount && !locked && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", borderRadius: 10, background: "#F3F7F1", border: "1px solid #CFE3C6" }}>
          <span style={{ fontSize: font.base, color: color.greenText }}>Suggested ask</span>
          <span style={{ fontSize: font.lg, fontWeight: 700, color: color.ink }}>{item.salary.amount}</span>
          <InfoTip label="How this is calculated" text={item.salary.note} />
          {text.replace(/[^\d]/g, "") !== item.salary.amount.replace(/[^\d]/g, "") && (
            <button onClick={() => run("save", { action: "edit", content: item.salary!.amount!, note: "Used Lookout's suggested ask." }, "Saved the suggested ask as a new version.")} disabled={!!busy} style={{ ...btn("outline"), height: 32, marginLeft: "auto" }}>
              Use it
            </button>
          )}
        </div>
      )}
      {letter && !locked && !editing && <StrategyPicker letter={letter} busy={!!busy || dirty} onPick={(s) => run("revise", { action: "redraft", strategy: s }, `Showing the letter: ${STRATEGY[s].label.toLowerCase()}.`)} />}

      {doc && !editing ? (
        <>
          {!locked && <TemplatePicker value={template} accent={accent} onPick={onTemplate} onAccent={onAccent} />}
          <DocPreview md={text} template={template} accent={accent} header={header} />
        </>
      ) : item.options?.length && item.fieldType === "multiselect" ? (
        <OptionChecks id={`it-${item.id}`} label={item.prompt} options={item.options} value={text} onChange={setText} disabled={locked} />
      ) : item.options?.length && !locked ? (
        <select id={`it-${item.id}`} value={text} onChange={(e) => setText(e.target.value)} style={{ height: 40, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 10px", fontSize: font.md, maxWidth: 420 }}>
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
          style={{ borderRadius: 10, border: `1.5px solid ${color.border}`, padding: 10, fontSize: font.md, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical", background: locked ? "#FAF8F5" : "#fff" }}
        />
      )}

      {shown && locked && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <VersionNotes v={shown} label />
        </div>
      )}

      {!locked && (
        <>
          {item.kind !== "field" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <ReviseBox
                id={`rv-${item.id}`}
                label={`Ask Lookout to revise ${item.prompt}`}
                placeholder={ASK[item.kind] ?? "Ask Lookout to update this answer"}
                value={instr}
                onChange={setInstr}
                busy={busy === "revise"}
                blocked={!!busy || dirty}
                tip={dirty ? "Save your edits first" : "Send"}
                onSend={() => run("revise", { action: "revise", instruction: instr, ...(shown ? { versionId: shown.id } : {}) }, "Lookout made a new version.")}
              />
              {item.kind === "cover_letter" && interviewHref && (
                <Link href={interviewHref} data-tip="The more Lookout knows about you, the better it can tie one of your stories to this company." style={{ ...btn("text"), height: 38, display: "inline-flex", alignItems: "center" }}>
                  Add a story
                </Link>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {outreach && (
              <button onClick={copy} disabled={!text.trim()} style={btn("outline")}>
                {copied ? "Copied" : "Copy draft"}
              </button>
            )}
            {doc && (
              <button onClick={() => setEditing((e) => !e)} aria-pressed={editing} aria-label={editing ? "Preview" : "Edit text"} data-tip={editing ? "Preview" : "Edit text"} style={iconBtn}>
                {editing ? <EyeIcon /> : <PencilIcon size={16} />}
              </button>
            )}
            {doc && !dirty && (
              <button
                onClick={() => run("revise", { action: "redraft" }, item.kind === "resume" ? "Lookout wrote a fresh resume from the posting." : "Lookout wrote a fresh cover letter from the posting.")}
                disabled={!!busy || blocked}
                aria-label={blocked ? "Redraft from the posting (approve the keywords first)" : "Redraft from the posting"}
                data-tip={blocked ? "Approve the keywords above first" : busy === "revise" ? "Working…" : "Redraft from the posting"}
                aria-busy={busy === "revise"}
                style={{ ...iconBtn, opacity: busy || blocked ? 0.45 : 1 }}
              >
                <RedoIcon />
              </button>
            )}
            {doc && !dirty && (
              <a href={`/api/apply/${appId}/items/${item.id}/docx`} aria-label="Download .docx" data-tip="Download .docx" style={{ ...iconBtn, textDecoration: "none", boxSizing: "border-box" }}>
                <DownloadIcon />
              </a>
            )}
            {item.versions.length > 1 && (
              <select aria-label="Version" value={shown?.id} onChange={(e) => setPick(e.target.value)} style={{ height: 38, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 8px", fontSize: font.base }}>
                {item.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version} · {v.author === "ai" ? "Lookout" : "you"}
                    {v.id === item.approvedVersionId ? " · approved" : ""}
                  </option>
                ))}
              </select>
            )}
            {shown && <VersionNotes v={shown} label={item.versions.length <= 1} />}
            <span style={{ flex: 1 }} />
            {dirty ? (
              <button onClick={() => run("save", { action: "edit", content: text, note: "" }, "Saved as a new version.")} disabled={!!busy} style={btn("outline")}>
                {busy === "save" ? "Saving…" : "Save as new version"}
              </button>
            ) : item.kind === "field" || outreach ? null : isApproved ? (
              <button onClick={() => run("approve", { action: "approve", versionId: null }, "Approval removed.")} disabled={!!busy} style={btn("text")}>
                Unapprove
              </button>
            ) : (
              <button onClick={() => shown && run("approve", { action: "approve", versionId: shown.id }, `Approved v${shown.version}.`)} disabled={!!busy || !shown?.content.trim()} style={{ ...btn("solid"), marginLeft: "auto" }}>
                {busy === "approve" ? "Approving…" : `Approve v${shown?.version ?? 1}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The revise box (#1665): a chat input with the interview's round send button inside it, in place of a Revise
 * button. Enter sends.
 */
function ReviseBox({ id, label, placeholder, value, onChange, onSend, busy, blocked, tip }: { id: string; label: string; placeholder: string; value: string; onChange: (v: string) => void; onSend: () => void; busy: boolean; blocked: boolean; tip: string }) {
  const ready = !blocked && !!value.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSend();
      }}
      style={{ flex: "1 1 260px", minWidth: 0, display: "flex", alignItems: "flex-end", gap: 4, border: `1.5px solid ${color.border}`, borderRadius: 14, background: "#fff", padding: "1px 3px 3px 12px" }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {/* Grows to show a prefilled fix in full, so the person reads what they send. Enter sends; Shift+Enter is a new line. */}
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (ready) onSend();
        }}
        rows={Math.min(4, Math.max(1, Math.ceil(value.length / 70)))}
        placeholder={placeholder}
        disabled={busy}
        style={{ flex: 1, minWidth: 0, padding: "9px 0", border: 0, outline: "none", resize: "none", fieldSizing: "content", maxHeight: 160, fontFamily: "inherit", fontSize: font.md, lineHeight: 1.4, background: "transparent", color: color.ink }}
      />
      <button type="submit" disabled={!ready} aria-label="Send" aria-busy={busy || undefined} data-tip={busy ? "Working…" : tip} style={{ width: 38, height: 38, flex: "none", padding: 0, border: 0, borderRadius: 999, background: "transparent", cursor: ready ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: ready ? color.brick : color.border, color: "#fff", transition: "background .15s", animation: busy ? "lookout-pulse 1.4s ease-in-out infinite" : undefined }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5" />
            <path d="M6 11l6-6 6 6" />
          </svg>
        </span>
      </button>
    </form>
  );
}

type LetterPick = LetterInfo["items"][string] & { suggested: LetterStrategy; why: string };

/**
 * Three ways to write the letter (#738). All three are written once (#1484), so a pick shows the stored letter.
 * A strategy not stored yet pulses and waits; a click never calls the model. The description and the reason for the pick live in the tooltips.
 */
function StrategyPicker({ letter, busy, onPick }: { letter: LetterPick; busy: boolean; onPick: (s: LetterStrategy) => void }) {
  const current = letter.strategy;
  return (
    <div role="group" aria-label="Cover letter strategy" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: font.base, fontWeight: 600, marginRight: 4 }}>
        3 ways to write it <InfoIcon tip="Each fits a different kind of role. All three are written, so switching is instant." label="Why three" />
      </span>
      {LETTER_STRATEGIES.map((s) => {
        const on = s === current;
        const waiting = !on && !letter.ready.includes(s);
        return (
          <button
            key={s}
            onClick={() => !on && onPick(s)}
            disabled={busy || waiting}
            aria-pressed={on}
            aria-busy={waiting || undefined}
            data-tip={s === letter.suggested ? `${STRATEGY[s].blurb} Suggested: ${letter.why}` : `${STRATEGY[s].blurb} Best ${STRATEGY[s].when}`}
            style={{ height: 32, padding: "0 12px", borderRadius: 999, fontSize: font.base, fontWeight: 600, cursor: on ? "default" : waiting ? "progress" : "pointer", border: `1.5px solid ${on ? color.ink : color.border}`, background: on ? color.ink : "#fff", color: on ? "#fff" : color.ink, animation: waiting ? "lookout-pulse 1.4s ease-in-out infinite" : undefined }}
          >
            {STRATEGY[s].label}
            {s === letter.suggested && <span style={{ fontWeight: 400, opacity: 0.8 }}> · suggested</span>}
          </button>
        );
      })}
    </div>
  );
}
