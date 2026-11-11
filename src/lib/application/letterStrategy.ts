import type { PersonalStory } from "@/lib/db/schema";
import type { StoryTheme } from "./stories";

/**
 * Cover letter strategies (#738): three ways to write a short letter. Lookout suggests one for the
 * role and the person can switch, which redrafts the letter with that strategy.
 */

export const LETTER_STRATEGIES = ["proof", "match", "why"] as const;
export type LetterStrategy = (typeof LETTER_STRATEGIES)[number];

export const STRATEGY: Record<LetterStrategy, { label: string; blurb: string; rule: string }> = {
  proof: {
    label: "Lead with proof",
    blurb: "Opens with your strongest result for this role, then one more example.",
    rule: "Cover letter strategy: lead with proof. The first sentence names the role and the single strongest result that shows the person fits it. One short paragraph with one more example that matches the posting's main ask. One closing line.",
  },
  match: {
    label: "Match the asks",
    blurb: "Takes the two or three things the posting asks for most and answers each with your work.",
    rule: "Cover letter strategy: match the asks. One opening sentence naming the role. Then the two or three things the posting asks for most, each answered by one sentence of the person's matching work. One closing line.",
  },
  why: {
    label: "Why this team",
    blurb: "Opens with why this company, from one of your stories, then the proof.",
    rule: "Cover letter strategy: why this team. Open with one line on why this company: from a personal story that truly fits (see the opening rule), else from what the posting says the team does, never an invented connection. Then the role and the strongest proof, one example, and one closing line.",
  },
};

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|vice president|manager|chief)\b/i;

// Posting words that show a company works in a story's theme.
const THEME_WORDS: Partial<Record<StoryTheme, RegExp>> = {
  health: /\b(health|patients?|care|clinical|medical|wellness|hospital)\b/gi,
  education: /\b(education|students?|learners?|learning|teachers?|schools?)\b/gi,
  finance: /\b(financ\w*|banking|payments?|money|savings|invest\w*)\b/gi,
  accessibility: /\b(accessib\w*|disabilit\w*|assistive|inclusive)\b/gi,
  entertainment: /\b(entertainment|games?|gaming|music|film|streaming|media)\b/gi,
  family: /\b(famil\w*|parents?|children|kids|caregiv\w*)\b/gi,
  community: /\b(communit\w*|nonprofit|civic|neighbou?rhoods?|volunteer\w*)\b/gi,
};

/** The story that fits this posting best, if one clearly does: its theme shows up in the posting at least twice. */
export function fittingStory(stories: PersonalStory[], postingText: string) {
  let best: { story: PersonalStory; hits: number } | null = null;
  for (const s of stories) {
    const re = THEME_WORDS[s.theme];
    const hits = re ? (postingText.match(re) ?? []).length : 0;
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
