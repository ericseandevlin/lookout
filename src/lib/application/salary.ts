/**
 * Salary asks (#139): anchor in the top quarter of the posted range, never below the person's floor,
 * never above the posted max (that screens people out before any negotiation). Plain math, so the
 * note can show it.
 */

import { parseMoney } from "@/lib/kinds";

const round5k = (n: number) => Math.round(n / 5000) * 5000;
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

const sentences = (t: string) => t.split(/(?<=[.?!])\s+|\n+/);
// "Includes a bonus" counts only in a sentence about the pay itself and not negated: "this range does not include bonus"
// is a base range, and "our total rewards include a bonus program" is a benefits list (#650).
const INCLUDES_BONUS = /\b(includ|reflect)\w*\b[^.?!]{0,40}?\b(bonus|commission|incentive)/i;
const ABOUT_PAY = /\b(range|salary|pay|compensation|amount|figure)\b/i;
const NEGATED = /(\bnot|n't)\s+(includ|reflect)|\bexclud|in addition to|on top of|\bseparate/i;
// Other ways a posting says its range is total cash (#690): "base pay plus bonus", "on-target earnings",
// "Total compensation range: $200,000 - $250,000".
const BASE_PLUS = /\bbase\b[^.?!]{0,30}?(\+|\bplus\b|\band\b)[^.?!]{0,20}?\b(bonus|commission|incentive)/i;
const THE_RANGE = /\b(range|figure|amount)s?\b/i;
const ON_TARGET = /\bon[- ]target earnings\b|\btotal (target )?(cash|compensation|comp|pay)\b[^.?!]{0,10}(range|:|\$)/i;
// "Total cash" and "OTE" count only where they name the range: in a sentence with the range or an amount, or as a short
// heading over it. "Beyond base pay, a bonus means total cash compensation may be higher" is about base (#795).
const TOTAL_CASH = /\btotal cash\b|\bOTE\b/i;
const NOT_TOTAL = /(\bnot|n't)\b[^.?!]{0,20}?(total cash|\bOTE\b)/i;
const NAMES_TOTAL = (s: string) =>
  TOTAL_CASH.test(s) && !NOT_TOTAL.test(s) && (THE_RANGE.test(s) || /[$\d]/.test(s) || s.trim().split(/\s+/).length <= 4);
const SAYS_TOTAL = (s: string) =>
  !NEGATED.test(s) && ((INCLUDES_BONUS.test(s) && ABOUT_PAY.test(s)) || (BASE_PLUS.test(s) && THE_RANGE.test(s)) || ON_TARGET.test(s) || NAMES_TOTAL(s));

/** What the posted range covers: total cash (bonus included), base, or the posting doesn't say. */
export const rangeBasis = (posting: string): "total" | "base" | null =>
  sentences(posting).some(SAYS_TOTAL)
    ? "total"
    : /\bbase (salary|pay|compensation)\b/i.test(posting)
      ? "base"
      : null;

/** The question asks for base pay, not base plus bonus or commission (#650). */
export const asksBase = (prompt: string) => /\bbase\b/i.test(prompt) && !/\bbase\s*(\+|plus|and|&)\s*(target )?(bonus|commission)/i.test(prompt);

/** The question asks for the lowest number the person would take. */
export const asksMinimum = (prompt: string) => /\bminimum\b|\bat least\b|\blowest\b/i.test(prompt);

// "What are you hoping to make in this role?", "How much would you like to earn?" (#813). "Make" isn't pay when it makes
// something: "What impact do you hope to make?", "looking to make a hire".
const HOPE_TO_EARN = /\b(hop\w*|want\w*|like|looking|aim\w*|need) to (earn\b|make\b(?!\s+(an?|the|this|that|it|sure|time|decisions?)\b))/i;
const MAKES_SOMETHING = /\b(impact|difference|change|contribution|progress|mark|decisions?|friends|connections?)\b/i;
const SALARY_ASK = {
  test: (s: string) =>
    /salary|compensation|wages?\b|pay (expectation|requirement)|expected (base|annual|pay)|desired (base|pay)|expect to (earn|make)\b/i.test(s) ||
    (HOPE_TO_EARN.test(s) && !MAKES_SOMETHING.test(s)),
};
const PAST_PAY =
  /\b(current|previous|prior|last|most recent|present)\b[^.?!]{0,20}\b(salary|compensation|pay|base|wages?)\b|\b(salary|compensation|pay|wage) history\b|\b(salary|compensation|pay|wages?)\b[^.?!]{0,25}\b(current|previous|prior|last) (job|role|position|employer)\b/i;
// "Are you comfortable with the posted salary range?" wants yes or no, not a number (#687).
// "Would you share your salary expectations?" is still an ask.
const YES_NO = /^\W*(are|is|does|do|would|will|can)\b/i;
const ABOUT_THEIR_RANGE = /\b(range|posted|listed|stated|above|acceptable|comfortable|work for you|align|meets?)\b/i;
const NAMES_A_NUMBER = /\b(expectations?|requirements?|desired|expected|target|how much|what)\b/i;
// A yes/no check stays one even when it says "expectations" ("Does the range meet your expectations?"), unless it asks
// them to give the number: "Would you share your salary expectations?" (#718).
const GIVE_A_NUMBER = /\b(share|provide|tell|give|list|state|enter|specify|what|how much)\b/i;
const rangeCheck = (s: string) => YES_NO.test(s) && ABOUT_THEIR_RANGE.test(s) && !GIVE_A_NUMBER.test(s);
// A sentence that only mentions pay isn't an ask: "Describe a time you negotiated compensation for your team",
// "Do you have experience designing compensation tools?" (#712). An ask names the number, says "your salary",
// says what they seek or expect, or is a short label like "Desired salary".
const OWN_NUMBER = /\byour (\w+ ){0,3}(salary|compensation|pay|wages?)\b|\b(seek\w*|looking for|expect\w*|anticipat\w*)\b/i;
// A sentence about pay work, not the person's own pay: "What compensation tools have you built?", "What is your
// experience with compensation benchmarking?" (#718). Only a plain ask for their number overrides it.
const ABOUT_WORK = /\b(experience|tools?|systems?|software|platforms?|programs?|benchmark\w*|strateg\w*|philosophy|built|build|designed|implement\w*|managed|administer\w*|processes|analys[ie]s|reviews|claims?)\b/i;
const PLAIN_ASK = /\b(expectations?|requirements?|desired|expected|target|how much|expect\w*|seek\w*|looking for|anticipat\w*|minimum|lowest)\b/i;
const asksForNumber = (s: string) =>
  PLAIN_ASK.test(s) || (!ABOUT_WORK.test(s) && (NAMES_A_NUMBER.test(s) || OWN_NUMBER.test(s) || s.trim().split(/\s+/).length <= 4));

/**
 * A salary ask, not a question about the person's own past or current pay. Judged sentence by sentence,
 * so a legal note after the ask ("We do not ask about salary history.") doesn't hide it (#640). A yes/no check on
 * their posted range isn't an ask (#687), and neither is a sentence that only mentions pay (#712).
 */
export const isSalaryQuestion = (prompt: string) => sentences(prompt).some((s) => SALARY_ASK.test(s) && asksForNumber(s) && !asksPastPay(s) && !rangeCheck(s));

/** The sentence asks about past pay, not "we do not need your current salary" or "current salary not required" (#652). */
function asksPastPay(s: string) {
  const m = s.match(PAST_PAY);
  if (!m || m.index === undefined) return false;
  const before = s.slice(0, m.index), after = s.slice(m.index + m[0].length);
  return !/(\bnot|n't|\bnever|\bno need to)\b[^.?!]{0,30}$/i.test(before) && !/^\s*(is |are )?(not (required|needed|necessary)|optional)\b/i.test(after);
}

/**
 * amount is null when Lookout shouldn't put a number in: the floor is above their range, or their range
 * is total cash and the question asks base. question is set when the person has to decide.
 */
export function suggestSalary(i: { floor?: unknown; target?: unknown; min?: number | null; max?: number | null; basis?: "total" | "base" | null; asksBase?: boolean; asksMinimum?: boolean }): { amount: string | null; note: string; question?: string } | null {
  // The same reading discovery uses for the floor, so "150" is $150,000 in both places (#761).
  const floor = parseMoney(i.floor);
  const target = parseMoney(i.target);
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
