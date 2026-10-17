import { answerKey } from "./saved";

/**
 * Voluntary EEO questions (#122). The person's answers live only in their profile, encrypted, and
 * are used only with their consent. Matching to each form's wording is plain code: these answers
 * never reach an AI model. Where no option matches, Lookout asks once and remembers that wording.
 */

export const EEO_CATEGORIES = ["gender", "transgender", "orientation", "race", "hispanic", "veteran", "disability"] as const;
export type EeoCategory = (typeof EEO_CATEGORIES)[number];

export type EeoProfile = {
  /** One answer per category, from EEO_CHOICES. */
  answers: Partial<Record<EeoCategory, string>>;
  /** Exact form wording -> the option the person picked there (answerKey of the question). */
  exact: Record<string, string>;
};

export const emptyEeo = (): EeoProfile => ({ answers: {}, exact: {} });

export const DECLINE = "Decline to self-identify";

/** What the profile offers per category. Forms word these many ways; matching handles that. */
export const EEO_CHOICES: Record<EeoCategory, { label: string; choices: string[] }> = {
  gender: { label: "Gender", choices: ["Woman", "Man", "Non-binary", DECLINE] },
  transgender: { label: "Transgender", choices: ["No", "Yes", DECLINE] },
  orientation: { label: "Sexual orientation", choices: ["Heterosexual or straight", "Gay", "Lesbian", "Bisexual or pansexual", "Queer", "Asexual", DECLINE] },
  race: {
    label: "Race or ethnicity",
    choices: ["American Indian or Alaska Native", "Asian", "Black or African American", "Hispanic or Latino", "Middle Eastern or North African", "Native Hawaiian or Pacific Islander", "White", "Two or more races", DECLINE],
  },
  hispanic: { label: "Hispanic or Latino", choices: ["No", "Yes", DECLINE] },
  veteran: { label: "Veteran status", choices: ["Not a veteran", "Veteran", DECLINE] },
  disability: { label: "Disability", choices: ["No", "Yes", DECLINE] },
};

/** Which category a form question asks about, or null when it isn't an EEO question we know. */
export function classify(prompt: string): EeoCategory | null {
  const p = prompt.toLowerCase();
  if (/transgender/.test(p)) return "transgender";
  if (/sexual orientation/.test(p)) return "orientation";
  if (/veteran|armed forces|military/.test(p)) return "veteran";
  if (/disabilit/.test(p)) return "disability";
  if (/\brace\b|racial|ethnic/.test(p)) return "race";
  if (/hispanic|latin[oax]/.test(p)) return "hispanic";
  if (/gender/.test(p)) return "gender";
  return null;
}

const DECLINES = /decline|don.?t wish|do not wish|prefer not|not to (answer|disclose|say|self)|choose not|rather not|wish not/i;

/** How each profile choice shows up in form options. Order matters: the first option that matches wins. */
const SYNONYMS: Record<string, RegExp> = {
  Woman: /^(woman|female)\b/i,
  Man: /^(man|male)\b/i,
  "Non-binary": /non.?binary|genderqueer/i,
  "Heterosexual or straight": /heterosexual|straight/i,
  Gay: /^gay\b/i,
  Lesbian: /lesbian/i,
  "Bisexual or pansexual": /bisexual|pansexual/i,
  Queer: /^queer\b/i,
  Asexual: /asexual/i,
  "American Indian or Alaska Native": /american indian|alaska|indigenous/i,
  Asian: /asian/i,
  "Black or African American": /black|african american|of african descent/i,
  "Hispanic or Latino": /hispanic|latin/i,
  "Middle Eastern or North African": /middle eastern|north african/i,
  "Native Hawaiian or Pacific Islander": /hawaiian|pacific islander/i,
  White: /^white\b|caucasian/i,
  "Two or more races": /two or more|multiracial|multiple races/i,
  "Not a veteran": /\bnot\b[^.]*veteran|^no\b|i am not/i,
  Veteran: /^yes|i am a veteran|identify as one or more|protected veteran/i,
  No: /^no\b|do not have|don.?t have/i,
  Yes: /^yes\b|i have a/i,
};

/** The form option for the person's answer, if one clearly matches. */
export function matchOption(choice: string, options: string[]): string | null {
  if (choice === DECLINE) return options.find((o) => DECLINES.test(o)) ?? null;
  const exact = options.find((o) => o.trim().toLowerCase() === choice.toLowerCase());
  if (exact) return exact;
  const re = SYNONYMS[choice];
  // "Not a veteran" must not match "I am a veteran", and the reverse: test the negative form first.
  if (choice === "Veteran") return options.find((o) => !SYNONYMS["Not a veteran"].test(o) && re.test(o)) ?? null;
  return re ? (options.find((o) => !DECLINES.test(o) && re.test(o)) ?? null) : null;
}

/** The answer to fill for one EEO question: the exact wording first, then the category answer. */
export function resolve(profile: EeoProfile, prompt: string, options: string[] | null): string | null {
  const opts = options ?? [];
  const saved = profile.exact[answerKey(prompt)];
  if (saved && (!opts.length || opts.includes(saved))) return saved;
  const cat = classify(prompt);
  const choice = cat ? profile.answers[cat] : undefined;
  if (!choice) return null;
  return opts.length ? matchOption(choice, opts) : choice;
}
