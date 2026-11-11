/**
 * Cover letter approaches (#738). A letter that tries to do everything reads dense and machine-made,
 * so each letter does one thing. Lookout picks the approach that fits the role; the person can switch.
 */
export const LETTER_STRATEGIES = ["personal", "proof", "plan"] as const;
export type LetterStrategy = (typeof LETTER_STRATEGIES)[number];

export const STRATEGY_LABEL: Record<LetterStrategy, string> = {
  personal: "Personal connection",
  proof: "One proof story",
  plan: "What I'd do first",
};

export const STRATEGY_HINT: Record<LetterStrategy, string> = {
  personal: "Opens with a real story of yours that ties you to the company, its brand or its purpose",
  proof: "One piece of your work that matches the main thing the posting asks for",
  plan: "What you would do in the first months, based on work you have done before",
};

const RULE: Record<LetterStrategy, string> = {
  personal:
    "personal: open with one or two plain sentences from one of the person's personal stories that ties them to what this company makes or stands for. Then one paragraph that links that story to the role, with one real piece of their work. Only when a story truly fits; never invent a memory, a use of the product, or a connection.",
  proof:
    "proof: name the one thing the posting needs most, then tell one piece of the person's work that shows they have done it: the situation, what they did, the result. One story, not a list.",
  plan: "plan: say what the person would do first in this role, as two or three concrete steps, each tied to something they have already done. No promises of results.",
};

/** The cover letter rules for the system prompt. */
export const LETTER_RULES = `- Cover letter: one approach per letter, never a mix. The approaches:
  ${LETTER_STRATEGIES.map((s) => RULE[s]).join("\n  ")}
  If the person asks for an approach, use it. Otherwise pick the one that fits this role and company best: personal when a story truly fits, else proof, and plan when the posting describes a problem to solve more than a list of requirements. Put the approach you used in strategy.
  Shape: 3 short paragraphs, 150 words or fewer, then a plain sign-off line. The first sentence names the role. Write the way the person would say it out loud to a friend in the field: short plain words, first person, uneven sentence lengths, no lists of three, no sentence that could sit in any other letter. No clichés or stock phrases ("I am excited to apply", "passionate", "dynamic", "I am confident", "proven track record", "aligns with", "resonates", "thrilled", "unique opportunity", "at the intersection of"). Do not restate the resume. Present relevant work they have already done in the target role's terms; never frame them as hoping to move into the field or lacking the title. Use only real experience.
- Personal stories (#155): put the story's id in storyId when the letter uses one. Use only what the story says. Interviewers ask about that line. If the letter uses no story, leave storyId empty and put one targeted question about this company in storyAsk. If the person asked for the personal approach and no story fits, write the proof approach instead and say so in the note.`;

const LINE = /^- Approach: (.+)$/m;

/** The line a version note carries, so the review page knows which approach a letter used. */
export const strategyLine = (s: LetterStrategy) => `- Approach: ${STRATEGY_LABEL[s]}`;

export function strategyOf(note: string | null | undefined): LetterStrategy | null {
  const label = note?.match(LINE)?.[1]?.trim();
  return LETTER_STRATEGIES.find((s) => STRATEGY_LABEL[s] === label) ?? null;
}

export const asStrategy = (s: string | undefined): LetterStrategy | null => LETTER_STRATEGIES.find((k) => k === s?.trim().toLowerCase()) ?? null;
