/**
 * Salary asks (#139): anchor in the top quarter of the posted range, never below the person's floor,
 * never above the posted max (that screens people out before any negotiation). Plain math, so the
 * note can show it.
 */

const parse = (v: unknown) => {
  const s = String(v ?? "").toLowerCase().replace(/[,\s$]/g, "");
  const m = s.match(/^(\d+(\.\d+)?)(k|m)?/);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[3] === "k" ? 1e3 : m[3] === "m" ? 1e6 : 1);
  return n >= 1000 ? Math.round(n) : null;
};
const round5k = (n: number) => Math.round(n / 5000) * 5000;
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

const sentences = (t: string) => t.split(/(?<=[.?!])\s+|\n+/);
// "Includes a bonus" counts only in a sentence about the pay itself and not negated: "this range does not include bonus"
// is a base range, and "our total rewards include a bonus program" is a benefits list (#650).
const INCLUDES_BONUS = /includ\w* (a )?(target )?bonus/i;
const ABOUT_PAY = /\b(range|salary|pay|compensation|amount|figure)\b/i;
const NEGATED = /(\bnot|n't)\s+includ/i;

/** What the posted range covers: total cash (bonus included), base, or the posting doesn't say. */
export const rangeBasis = (posting: string): "total" | "base" | null =>
  /total cash|\bOTE\b/i.test(posting) || sentences(posting).some((s) => INCLUDES_BONUS.test(s) && ABOUT_PAY.test(s) && !NEGATED.test(s))
    ? "total"
    : /\bbase (salary|pay|compensation)\b/i.test(posting)
      ? "base"
      : null;

/** The question asks for base pay, not base plus bonus or commission (#650). */
export const asksBase = (prompt: string) => /\bbase\b/i.test(prompt) && !/\bbase\s*(\+|plus|and|&)\s*(target )?(bonus|commission)/i.test(prompt);

/** The question asks for the lowest number the person would take. */
export const asksMinimum = (prompt: string) => /\bminimum\b|\bat least\b|\blowest\b/i.test(prompt);

const SALARY_ASK = /salary|compensation|pay (expectation|requirement)|expected (base|annual|pay)|desired (base|pay)/i;
const PAST_PAY =
  /\b(current|previous|prior|last|most recent|present)\b[^.?!]{0,20}\b(salary|compensation|pay|base)\b|\b(salary|compensation|pay) history\b|\b(salary|compensation|pay)\b[^.?!]{0,25}\b(current|previous|prior|last) (job|role|position|employer)\b/i;

/**
 * A salary ask, not a question about the person's own past or current pay. Judged sentence by sentence,
 * so a legal note after the ask ("We do not ask about salary history.") doesn't hide it (#640).
 */
export const isSalaryQuestion = (prompt: string) => sentences(prompt).some((s) => SALARY_ASK.test(s) && !PAST_PAY.test(s));

/**
 * amount is null when Lookout shouldn't put a number in: the floor is above their range, or their range
 * is total cash and the question asks base. question is set when the person has to decide.
 */
export function suggestSalary(i: { floor?: unknown; target?: unknown; min?: number | null; max?: number | null; basis?: "total" | "base" | null; asksBase?: boolean; asksMinimum?: boolean }): { amount: string | null; note: string; question?: string } | null {
  const floor = parse(i.floor);
  const target = parse(i.target);
  const lo = i.min ?? i.max ?? null;
  const hi = i.max ?? i.min ?? null;
  if (!lo || !hi) {
    const pick = target ?? floor;
    return pick ? { amount: usd(pick), note: `The posting gives no range, so this is your ${target ? "target" : "floor"}.` } : null;
  }
  const range = `${usd(lo)} – ${usd(hi)}${i.basis === "total" ? " total cash including bonus" : ""}`;
  if (floor && floor > hi) {
    const note = `Your floor (${usd(floor)}) is above their posted max (${range}), so Lookout left this blank. This role may not meet your minimum.`;
    return { amount: null, note, question: `${note} Decide whether to apply and what to ask.` };
  }
  if (i.basis === "total" && i.asksBase) {
    const note = `Their range (${range}) is total cash, but this question asks for base. Base is lower than total cash and the posting doesn't give the split, so Lookout left this blank instead of answering with a total-cash number.`;
    return { amount: null, note, question: `${note} What base salary do you want to ask for?` };
  }
  // Rounding to $5k can step outside a narrow range ($101k-$102k rounds to $100k), so pull it back in (#507).
  const topQuarter = Math.min(hi, Math.max(lo, round5k(lo + 0.75 * (hi - lo))));
  // The rule, and only the rule: the top quarter, or the person's target when it sits inside the range;
  // never below their floor, never above the posted max.
  const inRange = target && target >= lo && target <= hi ? target : null;
  const amount = Math.min(hi, Math.max(inRange ?? topQuarter, floor ?? 0));
  // The strategy in three rules, each with the reason a recruiter would give (#139).
  const lines = [
    `How Lookout picked ${usd(amount)} (their range: ${range})`,
    `• Top quarter of their range (${usd(topQuarter)}). You start high, and they still have room to come down to a number you'd take.`,
    `• Your target, if it's inside their range${inRange ? ` (${usd(inRange)})` : ""}. It's your number, and they can afford it.`,
    `• Never below your floor${floor ? ` (${usd(floor)})` : ""} or above their max (${usd(hi)}). Your walk-away number isn't your ask, and asking over budget gets you screened out.`,
    i.asksMinimum && floor && floor < lo && `• Minimum question: still answered inside their range. Naming less than they budgeted leaves money on the table.`,
    !i.basis && i.asksBase && `• The posting doesn't say whether this range is base or total cash. Check before you send it as base.`,
  ].filter(Boolean);
  return {
    amount: usd(amount),
    note: lines.join("\n"),
    ...(!i.basis && i.asksBase ? { question: `The posting doesn't say whether its range is base or total cash. Check before you send ${usd(amount)} as base.` } : {}),
  };
}
