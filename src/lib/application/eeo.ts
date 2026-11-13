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
  // "Do you identify as LGBTQ+ (lesbian, gay, bisexual, transgender...)?" asks neither one alone; ask the person (#909).
  if (/\blgbt|\blesbian|\bgay\b|\bbisexual|\bqueer\b/.test(p) && !/sexual orientation/.test(p)) return null;
  // "Transgender" among a gender question's examples, "Gender identity (e.g. woman, man, transgender)", is not the question (#929).
  const asked = p.replace(/\([^)]*\)/g, " ").replace(/\b(e\.g\.|such as|for example)[^?]*/g, " ");
  if (/transgender/.test(asked)) return "transgender";
  if (/sexual orientation/.test(p)) return "orientation";
  // "Are you a military spouse?" is about family, not the person's own service (#909).
  if (/veteran|armed forces|military/.test(p)) return /spouse|dependent|family member/.test(p) ? null : "veteran";
  if (/disabilit/.test(p)) return "disability";
  if (/\brace\b|racial|ethnic/.test(p)) return "race";
  if (/hispanic|latin[oax]/.test(p)) return "hispanic";
  // "Sex" alone asks gender; "sexual orientation" was caught above (#816).
  if (/gender|^\W*sex\b/.test(p)) return "gender";
  return null;
}

// "Prefer to not answer", "Opt out", "Undisclosed" and "Not specified" decline too (#754).
const DECLINES =
  /decline|don.?t (wish|want)|do not (wish|want)|prefer not|(not to|to not) (answer|disclose|say|self)|choose not|rather not|wish not|\bno answer\b|\bopt.?out\b|undisclosed|^not (specified|declared|disclosed)\b/i;

/** How each profile choice shows up in form options. Order matters: the first option that matches wins. */
const SYNONYMS: Record<string, RegExp> = {
  // "Cisgender woman" and "Cis Man" are the same answer; "Transgender man" never is (#816).
  Woman: /^(cis(gender)?[\s-]*)?(woman|female)\b/i,
  Man: /^(cis(gender)?[\s-]*)?(man|male)\b/i,
  "Non-binary": /non.?binary|genderqueer/i,
  "Heterosexual or straight": /heterosexual|straight/i,
  Gay: /^gay\b/i,
  Lesbian: /lesbian/i,
  "Bisexual or pansexual": /bisexual|pansexual/i,
  Queer: /^queer\b/i,
  Asexual: /asexual/i,
  "American Indian or Alaska Native": /american indian|alaska|indigenous/i,
  Asian: /\basian\b/i,
  "Black or African American": /black|african american|of african descent/i,
  "Hispanic or Latino": /hispanic|latin/i,
  "Middle Eastern or North African": /middle eastern|north african/i,
  "Native Hawaiian or Pacific Islander": /hawaiian|pacific islander/i,
  White: /^white\b|caucasian/i,
  "Two or more races": /two or more|multiracial|multiple races/i,
  "Not a veteran": /\bnot\b[^.]*veteran|^no\b|i am not/i,
  Veteran: /^yes|i am a veteran|identify as one or more|protected veteran/i,
  No: /^no\b|do not have|don.?t have|^not (hispanic|latin)/i,
  Yes: /^yes\b|i have a|^(hispanic|latin)/i,
};

/** The form option for the person's answer, if one clearly matches. */
export function matchOption(choice: string, options: string[]): string | null {
  if (choice === DECLINE) return options.find((o) => DECLINES.test(o)) ?? null;
  const exact = options.find((o) => o.trim().toLowerCase() === choice.toLowerCase());
  if (exact) return exact;
  const re = SYNONYMS[choice];
  // "Not a veteran" must not match "I am a veteran", and the reverse: test the negative form first.
  if (choice === "Veteran") return options.find((o) => !SYNONYMS["Not a veteran"].test(o) && re.test(o)) ?? null;
  // Workday race lists say "White (Not Hispanic or Latino)": a Hispanic person must not get one of those (#662).
  const negated = (o: string) => choice === "Hispanic or Latino" && /\bnot\s+(hispanic|latin)/i.test(o);
  return re ? (options.find((o) => !DECLINES.test(o) && re.test(o) && !negated(o)) ?? null) : null;
}

// Race names other than Hispanic or Latino. A race-worded question whose options name none of them asks only Hispanic ethnicity (#805).
const RACE_NAME = /american indian|alaska|indigenous|\basian\b|black|african|middle eastern|hawaiian|pacific islander|\bwhite\b|caucasian|two or more|multiracial|multiple races/i;

/** classify, plus the options: "Ethnicity" with "Hispanic or Latino" and "Not Hispanic or Latino" is the Hispanic question. */
function categoryOf(prompt: string, options: string[]): EeoCategory | null {
  const cat = classify(prompt);
  if (cat !== "race") return cat;
  const named = options.filter((o) => !DECLINES.test(o));
  const hispanic = /hispanic|latin[oax]/i.test(prompt) || named.some((o) => /hispanic|latin/i.test(o));
  return hispanic && named.length && !named.some((o) => RACE_NAME.test(o)) ? "hispanic" : cat;
}

/** The answer to fill for one EEO question: the exact wording first, then the category answer. */
export function resolve(profile: EeoProfile, prompt: string, options: string[] | null): string | null {
  const opts = options ?? [];
  const saved = profile.exact[answerKey(prompt)];
  if (saved && (!opts.length || opts.includes(saved))) return saved;
  const cat = categoryOf(prompt, opts);
  const choice = cat ? profile.answers[cat] : undefined;
  if (!choice) return null;
  return opts.length ? matchOption(choice, opts) : choice;
}
