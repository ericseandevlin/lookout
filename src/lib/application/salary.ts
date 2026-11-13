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
// "In addition to", "on top of" and "separate" put the bonus outside the range only when they are about the bonus:
// "includes base and bonus, in addition to equity" is still total cash (#937).
const NEGATED =
  /(\bnot|n't)\s+(includ|reflect)|\bexclud|\b(in addition to|on top of|separate(ly)? from)\b[^.?!]{0,60}?\b(bonus|commission|incentive)|\b(bonus|commission|incentive)\w*\s+(is|are)\s+(\w+\s+)?separate/i;
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
// What includes the bonus must be the pay or the range. "Our total rewards package includes base salary, bonus and
// equity" lists benefits; it says nothing about what the range covers (#815).
const PACKAGE = /\b(rewards?|benefits?|package|perks|offerings?)\b/i;
// "Total compensation also includes a bonus" is about the whole offer, not the posted range, unless it gives the amount
// itself: "Total compensation of $200k-$250k includes a bonus" (#927).
const WHOLE_OFFER = /\btotal (compensation|comp|pay)\b/i;
// Pay on top of the range: "also eligible for additional compensation, including a bonus", "Other compensation may
// include a bonus" (#1074). "Total compensation of $200k-$250k also includes a bonus" is left to WHOLE_OFFER.
const EXTRA_PAY = /\b(eligib\w*|additional|other|also)\b/i;
const PAY_INCLUDES_BONUS = (s: string) => {
  const m = s.match(INCLUDES_BONUS);
  if (!m || m.index === undefined) return false;
  const subject = s.slice(0, m.index);
  if (THE_RANGE.test(subject)) return ABOUT_PAY.test(s);
  if (WHOLE_OFFER.test(subject)) return /\$\s?\d/.test(s) && ABOUT_PAY.test(s) && !PACKAGE.test(subject);
  if (EXTRA_PAY.test(subject)) return false;
  return ABOUT_PAY.test(s) && !PACKAGE.test(subject);
};
const SAYS_TOTAL = (s: string) =>
  !NEGATED.test(s) && (PAY_INCLUDES_BONUS(s) || (BASE_PLUS.test(s) && THE_RANGE.test(s)) || ON_TARGET.test(s) || NAMES_TOTAL(s));

/** What the posted range covers: total cash (bonus included), base, or the posting doesn't say. */
export const rangeBasis = (posting: string): "total" | "base" | null =>
  sentences(posting).some(SAYS_TOTAL)
    ? "total"
    : /\bbase (salary|pay|compensation)\b/i.test(posting)
      ? "base"
      : null;

/** The question asks for base pay, not base plus bonus or commission (#650), "base salary and bonus" too (#1060). */
export const asksBase = (prompt: string) =>
  /\bbase\b/i.test(prompt) && !/\bbase\s*((salary|pay|compensation)\s*)?(\+|plus|and|&)\s*(target )?(bonus|commission)/i.test(prompt);

/** The question asks for the lowest number the person would take. */
export const asksMinimum = (prompt: string) => /\bminimum\b|\bat least\b|\blowest\b/i.test(prompt);

// "What are you hoping to make in this role?", "How much would you like to earn?" (#813). "Make" isn't pay when it makes
// something: "What impact do you hope to make?", "looking to make a hire".
const HOPE_TO_EARN = /\b(hop\w*|want\w*|like|looking|aim\w*|need) to (earn\b|make\b(?!\s+(an?|the|this|that|it|sure|time|decisions?)\b))/i;
const MAKES_SOMETHING = /\b(impact|difference|change|contribution|progress|mark|decisions?|friends|connections?)\b/i;
// Rate wording ("Desired hourly rate", "Expected rate per hour") is an ask too (#953). Not "day rate": askPer has no day period.
const SALARY_ASK = {
  test: (s: string) =>
    /salary|compensation|wages?\b|pay (expectation|requirement)|expected (base|annual|pay)|desired (base|pay)|expect to (earn|make)\b|\b(hourly|pay|bill) rate\b|\brate (expectation|requirement)|\b(desired|expected) rate\b/i.test(s) ||
    (HOPE_TO_EARN.test(s) && !MAKES_SOMETHING.test(s)),
};
const PAST_PAY =
  /\b(current|previous|prior|last|most recent|present)\b[^.?!]{0,20}\b(salary|compensation|pay|base|wages?)\b|\b(salary|compensation|pay|wage) history\b|\b(salary|compensation|pay|wages?)\b[^.?!]{0,25}\b(current|previous|prior|last) (job|role|position|employer)\b/i;
// "Are you comfortable with the posted salary range?" wants yes or no, not a number (#687).
// "Would you share your salary expectations?" is still an ask.
const YES_NO = /^\W*(are|is|does|do|would|will|can)\b/i;
const ABOUT_THEIR_RANGE = /\b(range|posted|listed|stated|above|acceptable|comfortable|work for you|align|meets?)\b/i;
// "What" asks for the number only right before the pay word: "What salary...", not "What questions do you have about
// compensation?" (#1069). "Target", "seeking" and "looking for" likewise only near the pay word.
const PAY_WORD = "(salary|compensation|pay|rate|wages?)";
const WHAT_PAY = new RegExp(`\\bwhat (\\w+ ){0,2}${PAY_WORD}\\b`, "i");
const SEEK_PAY = new RegExp(
  `\\btarget (\\w+ )?${PAY_WORD}\\b|\\b(looking for|seek\\w*)\\W+(\\w+\\W+){0,4}?${PAY_WORD}\\b|\\b${PAY_WORD}\\W+(\\w+\\W+){0,4}?(looking for|seek\\w*)\\b`,
  "i",
);
const NAMES_A_NUMBER = /\b(expectations?|requirements?|desired|expected|how much)\b/i;
// A yes/no check stays one even when it says "expectations" ("Does the range meet your expectations?"), unless it asks
// them to give the number: "Would you share your salary expectations?" (#718).
const GIVE_A_NUMBER = /\b(share|provide|tell|give|list|state|enter|specify|what|how much)\b/i;
const rangeCheck = (s: string) => YES_NO.test(s) && ABOUT_THEIR_RANGE.test(s) && !GIVE_A_NUMBER.test(s);
// A sentence that only mentions pay isn't an ask: "Describe a time you negotiated compensation for your team",
// "Do you have experience designing compensation tools?" (#712). An ask names the number, says "your salary",
// says what they seek or expect, or is a short label like "Desired salary".
const OWN_NUMBER = /\byour (\w+ ){0,3}(salary|compensation|pay|wages?)\b|\b(expect\w*|anticipat\w*)\b/i;
// A sentence about pay work, not the person's own pay: "What compensation tools have you built?", "What is your
// experience with compensation benchmarking?" (#718). Only a plain ask for their number overrides it.
const ABOUT_WORK = /\b(experience|tools?|systems?|software|platforms?|programs?|benchmark\w*|strateg\w*|philosophy|built|build|designed|implement\w*|managed|administer\w*|processes|analys[ie]s|reviews|claims?)\b/i;
const PLAIN_ASK = /\b(expectations?|requirements?|desired|expected|how much|expect\w*|anticipat\w*|minimum|lowest)\b/i;
const asksForNumber = (s: string) =>
  PLAIN_ASK.test(s) ||
  SEEK_PAY.test(s) ||
  (HOPE_TO_EARN.test(s) && !MAKES_SOMETHING.test(s)) ||
  // A short label ("Desired salary"), not a list in brackets after the question ("(team, compensation, growth)", #1069).
  (!ABOUT_WORK.test(s) && (NAMES_A_NUMBER.test(s) || WHAT_PAY.test(s) || OWN_NUMBER.test(s) || (!/^\s*\(/.test(s) && s.trim().split(/\s+/).length <= 4)));

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
/** The pay period the question asks in: "hourly wage expectations", "desired monthly salary". Null is a year (#949). */
export function askPer(prompt: string): "hour" | "week" | "month" | null {
  // "This role is salaried, not hourly" and "(non-hourly)" rule a period out, not in (#974).
  prompt = prompt.replace(/\b(not|non)[\s-]+(hourly|weekly|monthly|(per|an|a|each) (hour|hr|week|month))\b/gi, " ");
  // Working hours ("40 hours per week", "37.5 hrs/week") and a contract's length ("expected to last a year") are not
  // the pay period (#1002).
  prompt = prompt.replace(/\b(hours?|hrs?|days?)\s*(per|a|each|\/)\s*(week|wk|month|day)\b/gi, " ");
  prompt = prompt.replace(/\b(last(s|ing)?|for|within|after|over|least)\s+(about\s+|up to\s+|roughly\s+)?(a|one)\s+(year|month|week)\b/gi, " ");
  // "a year-end bonus" and "a year-long contract" are not a yearly ask (#1060).
  if (/\b(annual(ly)?|yearly|per (year|annum)|a year|\/\s?y(ea)?r)\b(?!-)/i.test(prompt)) return null;
  if (/\bhourly\b|\b(per|an|each) (hour|hr)\b|\/\s?h(ou)?r\b/i.test(prompt)) return "hour";
  if (/\bweekly\b|\b(per|a|each) week\b|\/\s?w(ee)?k\b/i.test(prompt) && !/\bbi-?weekly\b/i.test(prompt)) return "week";
  // Semi-monthly is paid twice a month: left yearly, like bi-weekly (#1002).
  if (/\bmonthly\b|\b(per|a|each) month\b|\/\s?mo(nth)?\b/i.test(prompt) && !/\bsemi-?monthly\b/i.test(prompt)) return "month";
  return null;
}

const PER: Record<"hour" | "week" | "month", { n: number; how: string }> = {
  hour: { n: 2080, how: "2,080 working hours" },
  week: { n: 52, how: "52 weeks" },
  month: { n: 12, how: "12 months" },
};

/**
 * The ask in the period the question uses. Every number above is a year's pay, so an hourly or monthly question gets
 * the yearly ask divided down, not "$165,000" in an hourly-rate field (#949).
 */
export function suggestSalary(i: Parameters<typeof yearlyAsk>[0] & { per?: "hour" | "week" | "month" | null }): { amount: string | null; note: string; question?: string } | null {
  const r = yearlyAsk(i);
  if (!r || !r.amount || !i.per) return r;
  const yearly = Number(r.amount.replace(/\D/g, ""));
  const p = PER[i.per];
  const amount = usd(Math.round(yearly / p.n));
  return { ...r, amount, ...(r.question ? { question: r.question.replace(r.amount, `${amount} per ${i.per}`) } : {}), note: `${r.note}\n• This question asks per ${i.per}, so the ask is ${r.amount} a year divided by ${p.how}: ${amount} per ${i.per}.` };
}

function yearlyAsk(i: { floor?: unknown; target?: unknown; min?: number | null; max?: number | null; basis?: "total" | "base" | null; asksBase?: boolean; asksMinimum?: boolean }): { amount: string | null; note: string; question?: string } | null {
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
