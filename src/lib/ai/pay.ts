/**
 * Finds the posted pay on a job page before the page text is trimmed for the model. ATS pages often put the pay
 * range at the very bottom (Greenhouse does), which a length cap cuts off. Sources, best first:
 * schema.org baseSalary, Greenhouse's embedded pay_ranges, then "$X - $Y" ranges in the visible text.
 */
import { decodeEntities } from "./entities";

export type Pay = { min: number; max: number; currency: string; source: string };

const HOURS_PER_YEAR = 2080;
const DAYS_PER_YEAR = 260;
const plausible = (n: number) => n >= 20_000 && n <= 2_000_000;

/** "$224,000", "224000", "$224K", "224.5k" -> 224000 */
export function money(s: string): number | null {
  const m = s.replace(/[\s$,]/g, "").match(/^(\d+(?:\.\d+)?)([kK])?$/);
  if (!m) return null;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}

function annual(min: number, max: number, unit: string, currency: string, source: string): Pay | null {
  // A day rate is 260 working days, the same as the pay floor reads it (#982, #1187).
  const k = /hour/i.test(unit) ? HOURS_PER_YEAR : /day/i.test(unit) ? DAYS_PER_YEAR : /semimonth/i.test(unit) ? 24 : /month/i.test(unit) ? 12 : /biweek/i.test(unit) ? 26 : /week/i.test(unit) ? 52 : 1;
  const lo = Math.round(Math.min(min, max) * k), hi = Math.round(Math.max(min, max) * k);
  return plausible(lo) && plausible(hi) && hi <= lo * 4 ? { min: lo, max: hi, currency, source } : null;
}

/**
 * A structured-data currency as a 3-letter code (#1130). Pages write "usd", "US$" or "$"; a lowercase "usd" read as a
 * foreign currency skipped the pay floor. Anything that isn't a code reads as USD, so page text never reaches the find.
 */
export function currencyCode(x: unknown): string {
  const s = typeof x === "string" ? x.trim().toUpperCase() : "";
  const sym: Record<string, string> = { $: "USD", US$: "USD", "€": "EUR", "£": "GBP" };
  return sym[s] ?? (/^[A-Z]{3}$/.test(s) ? s : "USD");
}

/** A structured-data amount: a number, or a string like "120,000" or "$120K". NaN when it's neither. */
const amount = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" ? (money(x) ?? NaN) : NaN);

function fromJsonLd(html: string): Pay | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    for (const node of [data].flat(2) as Record<string, unknown>[]) {
      const graph = (node?.["@graph"] as Record<string, unknown>[] | undefined) ?? [node];
      for (const n of graph) {
        // baseSalary may also be a list, one entry per location or level; the first plausible one wins (#850).
        for (const bs of [n?.baseSalary ?? []].flat() as Record<string, unknown>[]) {
          if (!bs || typeof bs !== "object") continue;
          // schema.org lets value be a QuantitativeValue or a plain number, with min/max and unitText on either level (#647).
          const v = (typeof bs.value === "object" && bs.value ? bs.value : { value: bs.value }) as Record<string, unknown>;
          const min = amount(v.minValue ?? bs.minValue ?? v.value), max = amount(v.maxValue ?? bs.maxValue ?? v.value);
          if (Number.isFinite(min) && Number.isFinite(max) && min > 0) {
            const p = annual(min, max, String(v.unitText ?? bs.unitText ?? "YEAR"), currencyCode(bs.currency ?? n.salaryCurrency), "structured data");
            if (p) return p;
          }
        }
      }
    }
  }
  return null;
}

/** Greenhouse amounts use the posting's local format, e.g. "€36.000" or "£60,000". Strip the symbol and
 *  treat a dot that is followed by exactly three digits as a thousands separator before feeding to money(). */
function greenhouseAmount(s: string): number | null {
  const cleaned = s.replace(/^[€£$¥]/, "").replace(/\.(?=\d{3}(?:[^\d]|$))/g, "");
  return money(cleaned);
}

function fromGreenhouse(html: string): Pay | null {
  const block = html.match(/"pay_ranges"\s*:\s*\[([^\]]*)\]/)?.[1];
  if (!block) return null;
  const min = greenhouseAmount(block.match(/"min"\s*:\s*"([^"]+)"/)?.[1] ?? "");
  const max = greenhouseAmount(block.match(/"max"\s*:\s*"([^"]+)"/)?.[1] ?? "");
  const cur = block.match(/"currency_type"\s*:\s*"([A-Z]{3})"/)?.[1] ?? "USD";
  return min && max ? annual(min, max, "YEAR", cur, "pay range") : null;
}

// A dollar amount: $224,000 / $224K / $224000 / $55.50 (hourly). The second end of a range may drop the "$" ("$224,000 - 308,000").
const AMT = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s?[kK]\b|\d{4,7}(?:\.\d+)?|\d{2,3}(?:\.\d{2})?`;
// A unit right after the first end, as in "$95/hr - $110/hr" or "$95 an hour - $110 an hour" (#682).
const FIRST_UNIT = String.raw`\s?(?:\/\s?|(?:per|an?)\s)(?:hours?|hr|h|days?|years?|yr|months?|mo|weeks?|wk)\b`;
// Either end may carry a currency: "US$120,000 - US$150,000", "CA$...", "$120,000 USD - $150,000 USD" (#686),
// "CAD $120,000 - $150,000" (#709). Only a three-letter code may have a space, so "a $120,000" stays a word.
// "S$", "SG$", "NZ$" and "HK$" name their dollar too (#883), and so do "AU$", "MX$", "NT$" and "SGD $120,000" (#905).
const DOLLARS = "USD|CAD|AUD|SGD|NZD|HKD|MXN|TWD";
const PRE = String.raw`(?:\b(US|CA|C|AU|A|SG|S|NZ|HK|MX|NT|(?:${DOLLARS}) ?)(?=\$))?`;
const CODE = String.raw`(?:\s?(${DOLLARS})\b)?`;
// A code may stand in for the "$": "USD 150,000 - 200,000" (#753). A bare "120,000 - 150,000" still doesn't count.
const CODE_LEAD = String.raw`\b(${DOLLARS})\s?(?=\d)`;
// The second end may carry the same symbol as the first: "£60,000 - £70,000" (#1186). The 40-character tail is read in a
// lookahead, so a bonus range the reader throws out doesn't swallow the salary right after it (#1205).
const range = (start: string, sep: string, lead = String.raw`${PRE}\$`, end = "") =>
  new RegExp(String.raw`${start}${lead}\s?(${AMT})(${FIRST_UNIT})?${CODE}\s*${sep}\s*${PRE}[$£€]?\s?(${AMT})${end}(?=([^\n]{0,40}))`, "gi");
// A pound or euro sign leads a range the way "$" does: "£60,000 - £70,000", "€50k - €60k" (#1186). Before, only Greenhouse
// and structured data read them, so a UK posting's pay reached the find as dollars and the USD floor cut it.
const OTHER_SIGN = "([£€])";
// Or the code comes only after the numbers: "180,000 - 220,000 USD", "180K - 220K CAD" (#809). The empty group keeps
// the match groups in line; the code stays in the tail, where the currency is read from.
const NO_LEAD = String.raw`()(?<![\d.,$])`;
const CODE_TRAIL = String.raw`(?=\s?(?:${DOLLARS})\b)`;
// "and" joins a range only after "between": "between $150,000 and $180,000" (#686).
const RANGES = [
  range("", "(?:-|–|—|to)"),
  range(String.raw`\bbetween\s+`, "and"),
  range("", "(?:-|–|—|to)", CODE_LEAD),
  range(String.raw`\bbetween\s+`, "and", CODE_LEAD),
  range("", "(?:-|–|—|to)", NO_LEAD, CODE_TRAIL),
  range(String.raw`\bbetween\s+`, "and", NO_LEAD, CODE_TRAIL),
  range("", "(?:-|–|—|to)", OTHER_SIGN),
  range(String.raw`\bbetween\s+`, "and", OTHER_SIGN),
];
// Euro and pound amounts written the European way: a dot or space between thousands, a comma before cents ("€60.000",
// "60 000 €", "€60.000,00"), and the sign before or after the number (#1199). At least one thousands group, so "€60.00" or
// a year never reads as one.
const EU_AMT = String.raw`\d{1,3}(?:[.\u00a0\u202f ]\d{3})+(?:,\d{1,2})?`;
const EU_SEP = "(?:-|–|—|to|bis)";
const EU_RANGES = [
  new RegExp(String.raw`([€£])\s?(${EU_AMT})(${FIRST_UNIT})?(?:\s?(EUR|GBP)\b)?\s*${EU_SEP}\s*([€£])?\s?(${EU_AMT})(?=([^\n]{0,40}))`, "gi"),
  new RegExp(String.raw`()(?<![\d.,$€£])(${EU_AMT})(${FIRST_UNIT})?(?:\s?([€£]|EUR\b|GBP\b))?\s*${EU_SEP}\s*()(${EU_AMT})(?=\s?(?:[€£]|EUR\b|GBP\b))(?=([^\n]{0,40}))`, "gi"),
];
const EU_NUMBER = new RegExp(`^${EU_AMT}$`);
/** "60.000" or "60 000,50" -> 60000 / 60000.5; anything else as money() reads it. */
const amountOf = (s: string) => (EU_NUMBER.test(s) ? Number(s.replace(/[.\u00a0\u202f ]/g, "").replace(",", ".")) : money(s));
const PREFIX: Record<string, string> = { us: "USD", ca: "CAD", c: "CAD", a: "AUD", s: "SGD", sg: "SGD", nz: "NZD", hk: "HKD", au: "AUD", mx: "MXN", nt: "TWD", "£": "GBP", "€": "EUR", eur: "EUR", gbp: "GBP", usd: "USD", cad: "CAD", aud: "AUD", sgd: "SGD", nzd: "NZD", hkd: "HKD", mxn: "MXN", twd: "TWD" };

// What the range is per, from the words after it. The unit named first wins, so "per year, paid monthly" stays yearly (#484)
// and "per hour, plus an annual bonus" stays hourly (#646).
const UNITS: [string, RegExp][] = [
  // "per hr", "an hr", "per mo", "per wk" and "per yr" read like the full words (#752).
  ["YEAR", /\/\s?y(?:ea)?r\b|\b(?:per|a|an|each) year\b|\bper (?:yr|annum)\b|\bannual(?:ly)?\b|\byearly\b/i],
  ["HOUR", /\/\s?h(?:ou)?r\b|\/\s?h\b|\b(?:per|a|an|each) hour\b|\b(?:per|an) hr\b|\bhourly\b/i],
  // "$600 - $800 per day", "a day rate of" after the numbers (#1187).
  ["DAY", /\/\s?day\b|\b(?:per|a|an|each) day\b|\bdaily\b|\bday rate\b/i],
  // "bi-weekly" is named before "weekly" inside it, so it wins as the unit named first (#708).
  ["BIWEEK", /\bbi-?weekly\b|\bevery (?:two|2) weeks\b/i],
  ["WEEK", /\/\s?w(?:ee)?k\b|\b(?:per|a|each) week\b|\bper wk\b|\bweekly\b/i],
  // "semi-monthly" is named before "monthly" inside it, so it wins the same way: 24 pay periods (#714).
  ["SEMIMONTH", /\bsemi-?monthly\b|\btwice (?:a|per|each) month\b/i],
  ["MONTH", /\/\s?mo(?:nth)?\b|\b(?:per|a|each) month\b|\bper mo\b|\bmonthly\b/i],
];
// "Paid bi-weekly" or "benefits paid monthly" says how often a paycheck comes, not what the range is per (#716).
const SCHEDULE = /\bpaid\s+(?:on\s+an?\s+)?(?:bi-?weekly|weekly|semi-?monthly|monthly|every (?:two|2) weeks|twice (?:a|per|each) month)\b/gi;
// "3 days a week" or "40 hours per week" is how much you work, not what the range is per (#732), and so is "8 hours a day" (#1187).
const WORKLOAD = /\b(?:\d+(?:\.\d+)?|one|two|three|four|five)(?:\s?(?:-|to)\s?\d+)?\s+(?:days?|hours?|hrs?)\s*(?:a|per|each|\/)\s*(?:week|day)\b/gi;
// Only punctuation and a currency code between the numbers and the unit: "/mo", " USD per month", "(monthly)". A "+" or
// "&" joins something else to the pay.
const RIGHT_AFTER = /^[\s,.;:()[\]\/-]*(?:(?:usd|cad|aud|eur|gbp|sgd|nzd|hkd|chf|jpy|inr|mxn)\b[\s,.;:()[\]\/-]*)?$/i;

/**
 * A range that already looks like a year's pay takes another unit only when it comes right after the numbers. Further
 * along the line it is about something else: "$95,000 - $115,000 plus a monthly wellness stipend", "hybrid 3x a week" (#881).
 */
function payUnit(tail: string, yearly = false) {
  let best: [string, number] = ["YEAR", Infinity];
  const said = tail.replace(WORKLOAD, " ");
  for (const [unit, re] of UNITS) {
    const at = said.search(re);
    if (at >= 0 && at < best[1]) best = [unit, at];
  }
  return yearly && best[0] !== "YEAR" && !RIGHT_AFTER.test(said.slice(0, best[1])) ? "YEAR" : best[0];
}

/**
 * The label right before a range: the start of its line, or the line above when the range starts its own line. "Hourly
 * rate: $45 - $55" and "Monthly salary\n$8,000 - $10,000" name the unit there, not after the numbers (#945).
 */
function label(text: string, at: number) {
  const lines = text.slice(Math.max(0, at - 120), at).split("\n");
  const own = lines.pop() ?? "";
  return (own.trim() ? own : (lines.pop() ?? "")).slice(-60);
}

function fromText(text: string): Pay | null {
  // In page order, so the first range on the page still wins.
  for (const m of [...RANGES, ...EU_RANGES].flatMap((re) => [...text.matchAll(re)]).sort((x, y) => x.index - y.index)) {
    const [, pre1, first, firstUnit, code, pre2, second, rest = ""] = m;
    // The unit is read only up to the next dollar amount: "$150,000 - $200,000 ($72-$96/hr)" stays yearly (#746).
    const tail = rest.split("$")[0];
    let a = amountOf(first);
    const b = amountOf(second);
    if (!a || !b) continue;
    // "$150-200K": the K on the second end covers a bare first end too (#682).
    if (a < 1000 && /k$/i.test(second) && !/k$/i.test(first)) a *= 1000;
    const said = `${firstUnit ?? ""} ${tail}`;
    const named = PREFIX[(pre1 ?? pre2 ?? "").trim().toLowerCase()] ?? (code ? (PREFIX[code.toLowerCase()] ?? code.toUpperCase()) : undefined);
    // The currency is read only up to the next number, so a Canada range after a US one doesn't make it CAD (#811).
    const own = tail.split(/\d/)[0];
    // Any common code there counts, so "SGD" or "NZD" after a range isn't read as US dollars (#883).
    const code3 = own.match(/\b(CAD|AUD|EUR|GBP|SGD|NZD|HKD|CHF|MXN|TWD|INR|JPY|CNY|USD)\b|€|£/)?.[0];
    // After a "$" lead another currency counts only as a code right after the numbers ("$60,000 - $70,000 EUR"). Further
    // on, or as a sign, it is another office's pay: "$150,000 - $180,000 (£110,000 - £130,000 in London)" (#1204).
    const adjacent = !!code3 && code3.length === 3 && /^[\s,.;:()[\]\/-]*$/.test(own.slice(0, own.indexOf(code3)));
    const dollarLead = /^\D*\$/.test(m[0]) && !!code3 && !adjacent && !new RegExp(`^(?:${DOLLARS})$`).test(code3);
    const currency = named ?? (dollarLead ? "USD" : code3 === "€" ? "EUR" : code3 === "£" ? "GBP" : (code3 ?? "USD"));
    // A range that is already a year's pay stays yearly when only a pay schedule follows it; "$4,000 - $5,000 paid
    // twice a month" still reads by the schedule (#716).
    const yearly = plausible(a) && plausible(b);
    const p =
      annual(a, b, payUnit(said.replace(SCHEDULE, " "), yearly), currency, "text") ??
      annual(a, b, payUnit(said, yearly), currency, "text") ??
      (yearly ? null : annual(a, b, payUnit(label(text, m.index).replace(SCHEDULE, " ")), currency, "text"));
    if (p) return p;
  }
  return null;
}

// Discovery passes only the HTML: drop scripts and styles, whose strings can swallow the real range, and decode
// entities, so "$150,000&ndash;$200,000" and "&#36;150,000" still read (#742).
const htmlText = (html: string) =>
  decodeEntities(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n").replace(/<[^>]+>/g, " "));

/** Pay from a fetched page's HTML; `text` is the page's readable text if you already have it. */
export function findPay(html: string, text?: string): Pay | null {
  return fromJsonLd(html) ?? fromGreenhouse(html) ?? fromText(text ?? htmlText(html));
}

export const payLine = (p: Pay) => `PAY ON PAGE (${p.source}): ${p.currency} ${p.min.toLocaleString("en-US")} to ${p.max.toLocaleString("en-US")} a year`;
