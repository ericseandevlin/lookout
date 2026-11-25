import type { PersonalStory } from "@/lib/db/schema";
import type { StoryTheme } from "./stories";

/**
 * Cover letter strategies (#738): three ways to write a short letter. Lookout suggests one for the
 * role and writes all three once (#1484), so a switch shows the stored letter with no model call.
 */

export const LETTER_STRATEGIES = ["proof", "match", "why"] as const;
export type LetterStrategy = (typeof LETTER_STRATEGIES)[number];

/** `when` finishes "Best …": when this strategy is the better choice, shown on the buttons Lookout didn't pick (#1665). */
export const STRATEGY: Record<LetterStrategy, { label: string; blurb: string; when: string; rule: string }> = {
  proof: {
    label: "Lead with proof",
    blurb: "Opens with your strongest result for this role, then one more example.",
    when: "for senior roles, which are hired on results.",
    rule: "Cover letter strategy: lead with proof. The first sentence names the role and the single strongest result that shows the person fits it. One short paragraph with one more example that matches the posting's main ask. One closing line.",
  },
  match: {
    label: "Match the asks",
    blurb: "Takes the two or three things the posting asks for most and answers each with your work.",
    when: "when the posting lists clear asks.",
    rule: "Cover letter strategy: match the asks. One opening sentence naming the role. Then the two or three things the posting asks for most, each answered by one sentence of the person's matching work. One closing line.",
  },
  why: {
    label: "Why this team",
    blurb: "Opens with why this company, from one of your stories, then the proof.",
    when: "when one of your stories fits what the company does.",
    rule: "Cover letter strategy: why this team. Open with one line on why this company: from a personal story that truly fits (see the opening rule), else from what the posting says the team does, never an invented connection. Then the role and the strongest proof, one example, and one closing line.",
  },
};

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|vice president|manager|chief)\b/i;

// Posting words that show a company works in a story's theme.
const THEME_WORDS: Partial<Record<StoryTheme, RegExp>> = {
  health: /\b(health|healthcare|patients?|care|clinical|medical|wellness|hospitals?)\b/gi,
  education: /\b(education|students?|learners?|learning|teachers?|schools?)\b/gi,
  finance: /\b(financ\w*|banking|payments?|money|savings|invest(?:ing|ments?|ors?)?)\b/gi,
  accessibility: /\b(accessib\w*|disabilit\w*|assistive|inclusive)\b/gi,
  entertainment: /\b(entertainment|games?|gaming|music|film|streaming|media)\b/gi,
  family: /\b(famil(?:y|ies)|parents?|children|kids|caregiv\w*)\b/gi,
  community: /\b(communit\w*|nonprofit|civic|neighbou?rhoods?|volunteer\w*)\b/gi,
};

// Benefits and tech phrases that use theme words but say nothing about what the company does (#856).
const NOT_THEME = [
  /\b(?:health|healthcare|medical|dental|vision|life|disability|wellness|well-being|wellbeing)(?:\s*(?:,|and|&|\/)\s*(?:health|healthcare|medical|dental|vision|life|disability))*\s+(?:insurance|plans?|benefits?|coverage|care|savings|accounts?|stipends?|programs?|reimbursements?|days?|allowances?|perks?)\b/gi,
  /\b(?:medical|dental|vision)\s*(?:,|and|&|\/)\s*(?:dental|vision|medical)\b/gi,
  /\b(?:health|wellness)\s+(?:and|&)\s+(?:wellness|wellbeing|well-being|fitness)\b/gi,
  /\b(?:hsa|fsa|health savings|flexible spending)\b/gi,
  /\b(?:machine|deep|reinforcement|federated|statistical)\s+learning\b/gi,
  /\blearning\s+(?:and|&)\s+development\b/gi,
  /\blearning\s+(?:budgets?|stipends?|allowances?)\b/gi,
  /\bcontinuous learning\b/gi,
  /\bsocial media\b/gi,
  // "Familiarity with", "investigate", "streaming APIs" and "media queries" are tech words (#1496).
  /\bmedia\s+quer(?:y|ies)\b/gi,
  /\bstreaming\s+(?:data|pipelines?|apis?|analytics|systems?|jobs?|ingestion)\b/gi,
  /\b(?:kafka|event|data|log|real-?time)\s+streaming\b/gi,
  /\b(?:paid\s+)?(?:family|parental)\s+(?:leave|planning|medical leave)\b/gi,
  /\bfamily[- ]friendly\b/gi,
  /\binvest(?:s|ing|ed)?\s+in\s+(?:our|its|your|you|their|the growth)\b/gi,
  /\b(?:we|who|that)\s+(?:truly\s+|really\s+|deeply\s+)?care\b/gi,
  /\btake care\b/gi,
];

const themeText = (t: string) => NOT_THEME.reduce((s, re) => s.replace(re, " "), t);

/** The story that fits this posting best, if one clearly does: its theme shows up in the posting at least twice. */
export function fittingStory(stories: PersonalStory[], postingText: string) {
  const text = themeText(postingText);
  let best: { story: PersonalStory; hits: number } | null = null;
  for (const s of stories) {
    const re = THEME_WORDS[s.theme];
    const hits = re ? (text.match(re) ?? []).length : 0;
    if (hits >= 2 && (!best || hits > best.hits)) best = { story: s, hits };
  }
  return best?.story ?? null;
}

/** Lookout's pick for a role, and one line on why. */
export function suggestStrategy(posting: { title: string; text: string }, stories: PersonalStory[]): { strategy: LetterStrategy; why: string } {
  if (fittingStory(stories, posting.text)) return { strategy: "why", why: "One of your stories fits what this company does." };
  if (SENIOR.test(posting.title)) return { strategy: "proof", why: "Senior roles are hired on results, so it opens with your strongest one." };
  return { strategy: "match", why: "The posting lists clear asks, so it answers them one by one." };
}

export const isStrategy = (s: unknown): s is LetterStrategy => typeof s === "string" && (LETTER_STRATEGIES as readonly string[]).includes(s);

/** One strategy's letter, kept so a switch needs no model call (#1484). */
export type LetterDraft = { content: string; note: string; sources: string[]; question: string | null; author: "ai" | "user" };

/**
 * A cover letter item's three letters (#1484). `current` is the strategy its latest version was written with.
 * `gen` names one round of drafting; background work from an older round never writes over a newer one.
 * `writing` is set while the other strategies are still being written.
 */
export type LetterSet = { current: LetterStrategy; gen: string; drafts: Partial<Record<LetterStrategy, LetterDraft>>; writing?: string };

/** Background drafts older than this count as failed, so the review page writes them again. */
export const WRITING_MS = 5 * 60_000;

export const isWriting = (set: LetterSet | undefined, now = Date.now()) => !!set?.writing && now - Date.parse(set.writing) < WRITING_MS;

/** What the strategy buttons need for one letter: the current pick, which are stored, and whether more are on the way. */
export function letterButtons(set: LetterSet | undefined, fallback: LetterStrategy | null, now = Date.now()) {
  return {
    strategy: set?.current ?? fallback,
    ready: LETTER_STRATEGIES.filter((s) => !!set?.drafts[s]),
    writing: isWriting(set, now),
  };
}
