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

/** What the posted range covers: total cash (bonus included), base, or the posting doesn't say. */
export const rangeBasis = (posting: string): "total" | "base" | null =>
  /total cash|includ\w* (a )?(target )?bonus|\bOTE\b/i.test(posting) ? "total" : /\bbase (salary|pay|compensation)\b/i.test(posting) ? "base" : null;

/** The question asks for base pay. */
export const asksBase = (prompt: string) => /\bbase\b/i.test(prompt);

/** The question asks for the lowest number the person would take. */
export const asksMinimum = (prompt: string) => /\bminimum\b|\bat least\b|\blowest\b/i.test(prompt);

export const isSalaryQuestion = (prompt: string) => /salary|compensation|pay (expectation|requirement)|expected (base|annual|pay)|desired (base|pay)/i.test(prompt) && !/history|current|previous|last/i.test(prompt);

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
  const topQuarter = round5k(lo + 0.75 * (hi - lo));
  // A target inside their range is the person's own number, so it wins over the top quarter; the floor still holds.
  const inRange = target && target >= lo && target <= hi ? target : null;
  const amount = Math.min(hi, inRange ? Math.max(inRange, floor ?? 0) : Math.max(topQuarter, floor ?? 0, target ?? 0));
  const why = amount === hi && target && target >= hi ? "their posted max, since your target is at or above it" : inRange && amount === inRange ? "your target, which sits inside their range" : amount === floor && floor > topQuarter ? "your floor, which sits in the top quarter of their range" : "the top quarter of their range";
  const minimum = i.asksMinimum && floor && floor < lo ? ` The question asks for your minimum, but answering with your floor (${usd(floor)}) would tell them you'd take less than the ${usd(lo)} they've budgeted, so this stays inside their range.` : "";
  const unclear = !i.basis && i.asksBase ? ` The posting doesn't say whether ${usd(lo)} – ${usd(hi)} is base or total cash. If it includes a bonus, base is lower; check before you use this.` : "";
  return {
    amount: usd(amount),
    note: `Their range is ${range}. This is ${why}: asking near the top leaves room to negotiate and stays inside their budget${floor ? `, and it's at or above your floor (${usd(floor)})` : ""}.${minimum}${unclear}`,
    ...(unclear ? { question: `The posting doesn't say whether its range is base or total cash. Check before you send ${usd(amount)} as base.` } : {}),
  };
}
