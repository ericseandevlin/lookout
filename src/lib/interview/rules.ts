import type { FactKind } from "@/lib/db/schema";

/**
 * The privacy rules Lookout applies to a fact by itself (#1449), held in code so the model can only add locks, never
 * take one away. The interviewer flags what it sees; anything flagged starts Private and says why.
 */

export type FactFlags = { namesPerson?: boolean; complaint?: boolean; confidential?: boolean; personal?: boolean };

export const LOCK = {
  complaint: "a complaint about a person or employer. Background only, never used in writing.",
  person: "it names a person. Stored by role, not by name.",
  confidential: "your employer's confidential details.",
  personal: "family, health or other personal life. If a form asks about it, Lookout asks you first.",
  pay: "past, current and wanted pay. Never sent to the AI that writes drafts.",
} as const;

// Words that make a sentence a complaint even when the model didn't say so.
const COMPLAINT = /\b(hated?|hates|awful|terrible|toxic|incompetent|micromanag\w*|blamed|unfair|useless|clueless|jerk|nightmare|worst)\b/i;

/** Why the fact starts Private, or null when it can be shared. */
export function lockReason(text: string, kind: FactKind, f: FactFlags = {}): string | null {
  if (kind === "pay") return LOCK.pay;
  if (f.complaint || COMPLAINT.test(text)) return LOCK.complaint;
  if (f.namesPerson) return LOCK.person;
  if (f.confidential) return LOCK.confidential;
  if (f.personal) return LOCK.personal;
  return null;
}

/** A topic as a key: lower case, plain words, so "F&B programs" and "f&b  programs" are one topic. */
export const topicKey = (t: string) =>
  t
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|a|an|of|for|experience|skills?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type BlockFact = { text: string; kind: FactKind; shareable: boolean };

/**
 * For drafting prompts: shareable facts only, never pay. The filter is here as well as in the query, so a caller
 * that passes every fact still can't leak a private one into a draft.
 */
export const factsBlock = (list: BlockFact[]) => {
  const ok = list.filter((f) => f.shareable && f.kind !== "pay");
  return ok.length
    ? `\n\n<interview_facts from the person, in their words; facts with the same standing as the resume>\n${ok.map((f) => `- ${f.text}`).join("\n")}\n</interview_facts>`
    : "";
};
