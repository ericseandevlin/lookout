"use client";

import type { ApplicationReport, ApplicationStatus } from "@/lib/db/schema";
import type { Template } from "@/lib/application/resumeLayout";
import type { KeywordRow } from "@/lib/application/evidence";
import type { SubmitMode } from "@/lib/application/submitMode";

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
};

export const card: React.CSSProperties = { padding: 18, borderRadius: 14, background: "#fff", border: "1.5px solid #E6E0D8" };
export const muted: React.CSSProperties = { fontSize: 14, color: "#6B6358" };

export type Act = (itemId: string, payload: Record<string, unknown>, done: string) => Promise<boolean>;

/** The resume as it will go out: the approved version, else the latest. */
export const resumeText = (d: Detail) => {
  const r = d.items.find((i) => i.kind === "resume");
  return (r?.versions.find((v) => v.id === r.approvedVersionId) ?? r?.versions[0])?.content;
};
