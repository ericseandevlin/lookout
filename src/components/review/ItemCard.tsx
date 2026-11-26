"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Template } from "@/lib/application/resumeLayout";
import { recruiterChecks } from "@/lib/application/recruiter";
import { btn } from "../Settings";
import { SendButton } from "../chat";
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

/** When each letter strategy is the better choice (#1665), in few words; the full blurb stays in the tooltip. */
const STRATEGY_WHEN: Record<LetterStrategy, string> = {
  proof: "For senior roles, or a standout result.",
  match: "When the posting lists hard asks.",
  why: "When you have a real reason to care.",
};

export function ItemCard({ appId, item, locked, act, interview = false, template, accent, header, letter, onTemplate, onAccent, needsKeywords = false }: { appId: string; item: Item; locked: boolean; act: Act; needsKeywords?: boolean; /** The /interview page exists only with FEATURE_INTERVIEW on. */ interview?: boolean; template: Template; accent: string | null; header: { name: string; contact: string; headline?: string } | null; letter?: LetterPick | null; onTemplate: (t: Template) => void; onAccent: (hex: string) => void }) {
  const latest = item.versions[0];
  const [pick, setPick] = useState<string | null>(null);
  const shown = item.versions.find((v) => v.id === pick) ?? item.versions.find((v) => v.id === item.approvedVersionId) ?? latest;
  // The letter's chat box opens with the top fix Lookout can make now, so sending it is one press (#1665).
  const prefill = useMemo(
    () => (item.kind === "cover_letter" ? recruiterChecks("cover_letter", shown?.content ?? "").find((f) => !f.needsFact)?.fix ?? "" : ""),
    [item.kind, shown?.content],
  );
  const [text, setText] = useState(shown?.content ?? "");
  const [instr, setInstr] = useState(prefill);
  const [busy, setBusy] = useState<null | "save" | "revise" | "approve">(null);
  // Reset the editor when the shown version changes (a pick, or a new version from the server).
  const key = `${shown?.id}:${shown?.content}`;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setText(shown?.content ?? "");
    // A new version starts a fresh ask; the letter opens with its next top fix (#1665).
    setInstr(prefill);
  }

  const outreach = item.kind === "outreach";
  // The resume is written from approved keywords; until then the server refuses a redraft (#1334).
  const blocked = item.kind === "resume" && needsKeywords;
  const isApproved = !outreach && !!shown && shown.id === item.approvedVersionId;
  const dirty = text !== (shown?.content ?? "");
  const doc = item.kind === "resume" || item.kind === "cover_letter";
  const [editing, setEditing] = useState(false);
  const [chatFocus, setChatFocus] = useState(false);
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
    if (ok && kind === "revise") setInstr("");
    setBusy(null);
  };
  // The chat box sends a revision, like the interview's composer: Enter sends, Shift+Enter makes a new line.
  const ask = () => {
    if (instr.trim() && !dirty && !busy) run("revise", { action: "revise", instruction: instr, ...(shown ? { versionId: shown.id } : {}) }, "Lookout made a new version.");
  };
  const askPlaceholder = item.kind === "resume" ? "Ask Lookout to update your resume" : item.kind === "cover_letter" ? "Ask Lookout to update your letter" : outreach ? "Ask Lookout to update your message" : "Ask Lookout to update your answer";

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, borderColor: isApproved ? "#9CC68E" : color.border }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <label htmlFor={`it-${item.id}`} style={{ flex: 1, minWidth: 0, fontSize: font.md, fontWeight: 600 }}>
          {item.prompt}
          {item.required ? <span style={{ color: color.brick }}> *</span> : !outreach && <span style={{ ...muted, fontWeight: 400 }}> (optional)</span>}
        </label>
        {isApproved && <span style={{ fontSize: font.base, fontWeight: 600, color: color.greenText }}>{item.kind === "field" ? "✓ Will be filled" : `✓ Approved v${shown.version}`}</span>}
      </div>
      {doc && item.question && !locked && (
        <div role="note" style={{ padding: "8px 12px", borderRadius: 10, background: "#FFF9F3", border: `1px solid ${color.orange}`, fontSize: font.base }}>
          {item.question}
        </div>
      )}
      {blocked && !locked && (
        <div style={{ ...muted, fontSize: font.sm }}>
          This resume is written from the keywords you approve.{" "}
          <a href="#keywords" onClick={(e) => { e.preventDefault(); document.getElementById("keywords")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
            Check the keywords above
          </a>{" "}
          and press &ldquo;Use these keywords&rdquo; to write it.
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
          </div>
          {item.kind !== "field" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask();
              }}
            >
              <div onFocus={() => setChatFocus(true)} onBlur={() => setChatFocus(false)} style={{ border: `1.5px solid ${chatFocus ? color.ink : color.border}`, borderRadius: 14, background: "#fff", padding: "4px 6px 4px", display: "flex", flexDirection: "column" }}>
                <label htmlFor={`rv-${item.id}`} className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  Ask Lookout to revise {item.prompt}
                </label>
                <textarea
                  id={`rv-${item.id}`}
                  value={instr}
                  onChange={(e) => setInstr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                    if (!(e.metaKey || e.ctrlKey) && window.matchMedia("(pointer: coarse)").matches) return;
                    e.preventDefault();
                    ask();
                  }}
                  rows={2}
                  maxLength={2000}
                  disabled={!!busy}
                  placeholder={askPlaceholder}
                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 8px 2px", border: 0, outline: "none", fontSize: font.base, lineHeight: 1.5, resize: "none", color: color.ink, background: "transparent" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px" }}>
                  {/* The more Lookout knows, the better it can tie a story to this company (#1665). */}
                  {item.kind === "cover_letter" && interview && (
                    <Link href={`/interview?app=${appId}`} style={{ fontSize: font.sm, color: color.t2, textDecoration: "underline", textUnderlineOffset: 3 }}>
                      Tell Lookout more for a richer letter
                    </Link>
                  )}
                  <span style={{ flex: 1 }} />
                  <SendButton ready={!!instr.trim() && !dirty && !busy} onClick={ask} tip={dirty ? "Save your edits first" : busy === "revise" ? "Working…" : "Send"} />
                </div>
              </div>
            </form>
          )}
          {/* Approve is the last button, right-aligned (#1665); it is the one that moves the application forward. */}
          {(dirty || (!outreach && item.kind !== "field")) && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
              {dirty ? (
                <button onClick={() => run("save", { action: "edit", content: text, note: "" }, "Saved as a new version.")} disabled={!!busy} style={btn("outline")}>
                  {busy === "save" ? "Saving…" : "Save as new version"}
                </button>
              ) : isApproved ? (
                <button onClick={() => run("approve", { action: "approve", versionId: null }, "Approval removed.")} disabled={!!busy} style={btn("text")}>
                  Unapprove
                </button>
              ) : (
                <button onClick={() => shown && run("approve", { action: "approve", versionId: shown.id }, `Approved v${shown.version}.`)} disabled={!!busy || !shown?.content.trim()} style={btn("solid")}>
                  {busy === "approve" ? "Approving…" : `Approve v${shown?.version ?? 1}`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type LetterPick = LetterInfo["items"][string] & { suggested: LetterStrategy; why: string };

/**
 * Three ways to write the letter (#738). All three are written once (#1484), so a pick shows the stored letter.
 * A strategy not stored yet pulses and waits; a click never calls the model. The caption says when each is the
 * better choice (#1665); the description and the reason for the pick live in the tooltips.
 */
function StrategyPicker({ letter, busy, onPick }: { letter: LetterPick; busy: boolean; onPick: (s: LetterStrategy) => void }) {
  const current = letter.strategy;
  return (
    <div role="group" aria-label="Cover letter strategy" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
      <span style={{ fontSize: font.base, fontWeight: 600, marginRight: 4 }}>Strategy</span>
      {LETTER_STRATEGIES.map((s) => {
        const on = s === current;
        const waiting = !on && !letter.ready.includes(s);
        return (
          <div key={s} style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
            <button
              onClick={() => !on && onPick(s)}
              disabled={busy || waiting}
              aria-pressed={on}
              aria-busy={waiting || undefined}
              data-tip={s === letter.suggested ? `${STRATEGY[s].blurb} Suggested: ${letter.why}` : STRATEGY[s].blurb}
              style={{ height: 32, padding: "0 12px", borderRadius: 999, fontSize: font.base, fontWeight: 600, cursor: on ? "default" : waiting ? "progress" : "pointer", border: `1.5px solid ${on ? color.ink : color.border}`, background: on ? color.ink : "#fff", color: on ? "#fff" : color.ink, animation: waiting ? "lookout-pulse 1.4s ease-in-out infinite" : undefined }}
            >
              {STRATEGY[s].label}
              {s === letter.suggested && <span style={{ fontWeight: 400, opacity: 0.8 }}> · suggested</span>}
            </button>
            <span style={{ fontSize: font.xs, color: color.t2, lineHeight: 1.3 }}>{STRATEGY_WHEN[s]}</span>
          </div>
        );
      })}
    </div>
  );
}
