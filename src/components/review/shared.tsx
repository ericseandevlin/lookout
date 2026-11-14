"use client";

import type { ApplicationReport, ApplicationStatus } from "@/lib/db/schema";
import type { Template } from "@/lib/application/resumeLayout";
import type { KeywordRow } from "@/lib/application/evidence";
import type { LetterStrategy } from "@/lib/application/letterStrategy";
import type { SubmitMode } from "@/lib/application/submitMode";
import { toggleOption } from "@/lib/application/flowRules";
import { color, font } from "@/lib/tokens";

/** Shared by the review page parts: the response types, the card styles and the resume lookup. */

export type Version = { id: string; version: number; content: string; note: string; author: "user" | "ai"; sources: string[]; createdAt: string };
export type Item = {
  id: string;
  kind: string;
  prompt: string;
  required: boolean;
  fieldType: string | null;
  options: string[] | null;
  question: string | null;
  approvedVersionId: string | null;
  /** EEO only: the answer matched from the person's profile (with consent), never stored on the application. */
  eeoAnswer?: string | null;
  /** Salary questions: the suggested ask and how it was worked out (#139). */
  salary?: { amount: string | null; note: string } | null;
  versions: Version[];
};
export type Detail = {
  id: string;
  findId: string;
  status: ApplicationStatus;
  ats: string | null;
  route: string | null;
  report: ApplicationReport;
  submittedAt: string | null;
  confirmation: { sent?: { prompt: string; version: number; content: string }[] } | null;
  company: string;
  role: string;
  url: string | null;
  posting: string;
  autoSubmit: boolean;
  /** Who presses Submit (#187), shown before approval. */
  submit: SubmitMode;
  eeoConsent: boolean;
  template: Template;
  accent: string | null;
  items: Item[];
  /** Keywords with the posting line and the person's own line behind each (#121). */
  keywordRows: KeywordRow[] | null;
  keywordsApproved: boolean;
  /** Up to three unbacked keywords worth adding experience for (#738). */
  keywordPicks: string[];
  /** The cover letter's strategy (null on older letters) and Lookout's pick for this role (#738). */
  letter: { strategy: LetterStrategy | null; suggested: LetterStrategy; why: string } | null;
};

export const card: React.CSSProperties = { padding: 18, borderRadius: 14, background: "#fff", border: `1.5px solid ${color.border}` };
export const muted: React.CSSProperties = { fontSize: font.base, color: color.t2 };

/** A select-any question (#627): one checkbox per option; the answer is the ticked options, one per line. */
export function OptionChecks({ id, label, options, value, onChange, disabled }: { id: string; label: string; options: string[]; value: string; onChange: (next: string) => void; disabled?: boolean }) {
  const picked = new Set(value.split("\n"));
  return (
    <div id={id} role="group" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {options.map((o) => (
        <label key={o} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: font.md }}>
          <input type="checkbox" checked={picked.has(o)} disabled={disabled} onChange={() => onChange(toggleOption(value, options, o))} />
          {o}
        </label>
      ))}
    </div>
  );
}

export type Act = (itemId: string, payload: Record<string, unknown>, done: string) => Promise<boolean>;

/** The resume as it will go out: the approved version, else the latest. */
export const resumeText = (d: Detail) => {
  const r = d.items.find((i) => i.kind === "resume");
  return (r?.versions.find((v) => v.id === r.approvedVersionId) ?? r?.versions[0])?.content;
};
