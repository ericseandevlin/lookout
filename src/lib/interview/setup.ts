import type { FactKind, ProfileAnswers } from "@/lib/db/schema";
import { answeredCount, type KindConfig, type Question } from "@/lib/kinds";

/**
 * The five setup questions (the Questions page) as the interview's first turns (#1449). Typed answers are written
 * back onto the search's answers, so searches read them exactly as before, and each one becomes a setup fact.
 */

export const SETUP_WHY = "One of the five setup questions. Every search starts from your answer.";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export const isAnswered = (cfg: KindConfig, q: Question, a: ProfileAnswers) => answeredCount({ ...cfg, questions: [q] }, a) > 0;

/** The question as the interview asks it: the prompt, then a hint. */
export function setupQuestionText(q: Question) {
  if (q.kind === "comp") return `${q.prompt} A floor and a number that would make you move, for example "140k floor, 180k to jump".`;
  if (q.kind === "modes") return `${q.prompt} On-site, hybrid or remote, and which areas.`;
  return `${q.prompt} ${q.helper}`;
}

/** "$140,000", "140k", "1.2m", or a bare "140" meaning thousands. */
function amounts(text: string) {
  const out: number[] = [];
  for (const m of text.matchAll(/\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\b/gi)) {
    let n = Number(m[1].replace(/,/g, ""));
    const unit = m[2]?.toLowerCase();
    if (unit === "k") n *= 1e3;
    else if (unit === "m") n *= 1e6;
    else if (n < 1000) n *= 1e3;
    if (n >= 10_000 && n <= 10_000_000) out.push(Math.round(n));
  }
  return out;
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const MODES: [RegExp, string][] = [
  [/\bon[- ]?site\b|\bin (the )?office\b|\bin person\b/i, "On-site"],
  [/\bhybrid\b/i, "Hybrid"],
  [/\bremote\b|\bfrom home\b/i, "Remote"],
];

export type SetupResult = { answers: ProfileAnswers; fact: { text: string; kind: FactKind } };

/** A typed answer to one setup question: what goes onto the search's answers, and the fact it saves. */
export function readSetupAnswer(q: Question, text: string): SetupResult {
  const t = text.trim();
  if (q.kind === "comp") {
    const [lo, hi] = amounts(t);
    const floor = lo && hi ? Math.min(lo, hi) : lo;
    const target = lo && hi ? Math.max(lo, hi) : undefined;
    const answers: ProfileAnswers = floor ? { [q.floorKey]: String(floor), ...(target && { [q.targetKey]: String(target) }) } : {};
    const said = floor ? `Pay floor ${money(floor)}${target ? `; would move for ${money(target)}` : ""}.` : t;
    return { answers, fact: { text: said, kind: "pay" } };
  }
  if (q.kind === "modes") {
    const modes = MODES.filter(([re]) => re.test(t)).map(([, m]) => m).filter((m) => q.options.includes(m));
    const area = MODES.reduce((s, [re]) => s.replace(new RegExp(re.source, "gi"), ""), t)
      .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
      .replace(/^(or|and|in|around)\s+/i, "")
      .trim();
    return { answers: { [q.modesKey]: modes, [q.areaKey]: area }, fact: { text: t, kind: "next_role" } };
  }
  return { answers: { [q.key]: t }, fact: { text: t, kind: factKind(q) } };
}

/** What a setup answer is: the lead win is a result, what's off the table a dealbreaker (#1531), the rest the next role. */
const factKind = (q: Question): FactKind => (q.key === "q4" ? "result" : q.key === "q5" ? "dealbreaker" : "next_role");

/** An answer already on the search, as a fact, for the one-time copy when the interview first opens. */
export function setupFact(q: Question, a: ProfileAnswers): { text: string; kind: FactKind } | null {
  if (q.kind === "comp") {
    const floor = Number(str(a[q.floorKey])) || 0;
    const target = Number(str(a[q.targetKey])) || 0;
    if (!floor && !target) return null;
    return { text: [floor && `Pay floor ${money(floor)}`, target && `would move for ${money(target)}`].filter(Boolean).join("; ") + ".", kind: "pay" };
  }
  if (q.kind === "modes") {
    const modes = Array.isArray(a[q.modesKey]) ? (a[q.modesKey] as string[]) : [];
    const area = str(a[q.areaKey]);
    if (!modes.length && !area) return null;
    return { text: [modes.length && `Works ${modes.join(" or ").toLowerCase()}`, area && `in ${area}`].filter(Boolean).join(" "), kind: "next_role" };
  }
  const v = str(a[q.key]);
  if (!v) return null;
  return { text: v, kind: factKind(q) };
}
