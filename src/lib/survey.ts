import type { SurveyKind } from "@/lib/db/schema";

/**
 * One-question beta surveys (#5): a short note from Eric, one question at a time, at most once
 * every N days per person. Dismissing counts as an answer (a skip), so nobody is asked twice.
 */

export type SurveyQuestion = { id: string; kind: SurveyKind; prompt: string; options: string[] };

export const SCALE = ["1", "2", "3", "4", "5"] as const;
export const MAX_TEXT = 1000;

/** Due when the person has never been asked, or their last answer or skip is at least N days old. */
export function isDue(lastAskedAt: Date | null, everyDays: number, now = new Date()) {
  return !lastAskedAt || now.getTime() - lastAskedAt.getTime() >= everyDays * 864e5;
}

/** A reply as stored: one of the choices, "1" to "5", or trimmed text. Null means skipped. Throws on anything else. */
export function cleanAnswer(q: Pick<SurveyQuestion, "kind" | "options">, raw: string | null): string | null {
  if (raw === null) return null;
  const v = raw.trim();
  if (q.kind === "choice") {
    if (!q.options.includes(v)) throw new Error("Pick one of the choices.");
    return v;
  }
  if (q.kind === "scale") {
    if (!(SCALE as readonly string[]).includes(v)) throw new Error("Pick a number from 1 to 5.");
    return v;
  }
  if (!v) throw new Error("Write an answer, or skip.");
  return v.slice(0, MAX_TEXT);
}

/** Options as an admin types them: one per line, blanks and repeats dropped. A choice question needs two or more. */
export function cleanOptions(kind: SurveyKind, lines: string[]): string[] {
  if (kind !== "choice") return [];
  const out = [...new Set(lines.map((l) => l.trim()).filter(Boolean))].map((l) => l.slice(0, 120)).slice(0, 8);
  if (out.length < 2) throw new Error("A multiple-choice question needs at least two choices.");
  return out;
}

const cell = (s: string) => (/[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${(/^[=+\-@\t]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s);

/** Answers for one question as CSV. Cells that start like a formula are quoted with a leading ' so a spreadsheet won't run them. */
export function answersCsv(prompt: string, rows: { email: string; name: string; answer: string | null; at: Date }[]) {
  const lines = [["question", "email", "name", "answer", "skipped", "answered_at"].join(",")];
  for (const r of rows) lines.push([prompt, r.email, r.name, r.answer ?? "", r.answer === null ? "yes" : "no", r.at.toISOString()].map(cell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
