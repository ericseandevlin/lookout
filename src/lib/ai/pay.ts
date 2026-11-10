/**
 * Finds the posted pay on a job page before the page text is trimmed for the model. ATS pages often put the pay
 * range at the very bottom (Greenhouse does), which a length cap cuts off. Sources, best first:
 * schema.org baseSalary, Greenhouse's embedded pay_ranges, then "$X - $Y" ranges in the visible text.
 */
export type Pay = { min: number; max: number; currency: string; source: string };

const HOURS_PER_YEAR = 2080;
const plausible = (n: number) => n >= 20_000 && n <= 2_000_000;

/** "$224,000", "224000", "$224K", "224.5k" -> 224000 */
export function money(s: string): number | null {
  const m = s.replace(/[\s$,]/g, "").match(/^(\d+(?:\.\d+)?)([kK])?$/);
  if (!m) return null;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}

function annual(min: number, max: number, unit: string, currency: string, source: string): Pay | null {
  const k = /hour/i.test(unit) ? HOURS_PER_YEAR : /month/i.test(unit) ? 12 : /week/i.test(unit) ? 52 : 1;
  const lo = Math.round(Math.min(min, max) * k), hi = Math.round(Math.max(min, max) * k);
  return plausible(lo) && plausible(hi) && hi <= lo * 4 ? { min: lo, max: hi, currency, source } : null;
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
        const bs = n?.baseSalary as Record<string, unknown> | undefined;
        if (!bs) continue;
        // schema.org lets value be a QuantitativeValue or a plain number, with min/max and unitText on either level (#647).
        const v = (typeof bs.value === "object" && bs.value ? bs.value : { value: bs.value }) as Record<string, unknown>;
        const min = amount(v.minValue ?? bs.minValue ?? v.value), max = amount(v.maxValue ?? bs.maxValue ?? v.value);
        if (Number.isFinite(min) && Number.isFinite(max) && min > 0) {
          const p = annual(min, max, String(v.unitText ?? bs.unitText ?? "YEAR"), String(bs.currency ?? "USD"), "structured data");
          if (p) return p;
        }
      }
    }
  }
  return null;
}

function fromGreenhouse(html: string): Pay | null {
  const block = html.match(/"pay_ranges"\s*:\s*\[([^\]]*)\]/)?.[1];
  if (!block) return null;
  const min = money(block.match(/"min"\s*:\s*"([^"]+)"/)?.[1] ?? "");
  const max = money(block.match(/"max"\s*:\s*"([^"]+)"/)?.[1] ?? "");
  const cur = block.match(/"currency_type"\s*:\s*"([A-Z]{3})"/)?.[1] ?? "USD";
  return min && max ? annual(min, max, "YEAR", cur, "pay range") : null;
}

// A dollar amount: $224,000 / $224K / $224000 / $55.50 (hourly). The second end of a range may drop the "$" ("$224,000 - 308,000").
const AMT = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s?[kK]\b|\d{4,7}(?:\.\d+)?|\d{2,3}(?:\.\d{2})?`;
// A unit right after the first end, as in "$95/hr - $110/hr" or "$95 an hour - $110 an hour" (#682).
const FIRST_UNIT = String.raw`\s?(?:\/\s?|(?:per|an?)\s)(?:hours?|hr|h|years?|yr|months?|mo|weeks?|wk)\b`;
// Either end may carry a currency: "US$120,000 - US$150,000", "CA$...", "$120,000 USD - $150,000 USD" (#686).
const PRE = String.raw`(?:\b(US|CA|C|A)(?=\$))?`;
const CODE = String.raw`(?:\s?(USD|CAD|AUD)\b)?`;
const range = (start: string, sep: string) =>
  new RegExp(String.raw`${start}${PRE}\$\s?(${AMT})(${FIRST_UNIT})?${CODE}\s*${sep}\s*${PRE}\$?\s?(${AMT})([^\n]{0,40})`, "gi");
// "and" joins a range only after "between": "between $150,000 and $180,000" (#686).
const RANGES = [range("", "(?:-|–|—|to)"), range(String.raw`\bbetween\s+`, "and")];
const PREFIX: Record<string, string> = { us: "USD", ca: "CAD", c: "CAD", a: "AUD" };

// What the range is per, from the words after it. The unit named first wins, so "per year, paid monthly" stays yearly (#484)
// and "per hour, plus an annual bonus" stays hourly (#646).
const UNITS: [string, RegExp][] = [
  ["YEAR", /\/\s?y(?:ea)?r\b|\b(?:per|a|an|each) year\b|\bannual(?:ly)?\b|\byearly\b/i],
  ["HOUR", /\/\s?h(?:ou)?r\b|\/\s?h\b|\b(?:per|a|an|each) hour\b|\bhourly\b/i],
  ["WEEK", /\/\s?w(?:ee)?k\b|\b(?:per|a|each) week\b|\bweekly\b/i],
  ["MONTH", /\/\s?mo(?:nth)?\b|\b(?:per|a|each) month\b|\bmonthly\b/i],
];
function payUnit(tail: string) {
  let best: [string, number] = ["YEAR", Infinity];
  for (const [unit, re] of UNITS) {
    const at = tail.search(re);
    if (at >= 0 && at < best[1]) best = [unit, at];
  }
  return best[0];
}

function fromText(text: string): Pay | null {
  // In page order, so the first range on the page still wins.
  for (const m of RANGES.flatMap((re) => [...text.matchAll(re)]).sort((x, y) => x.index - y.index)) {
    const [, pre1, first, firstUnit, code, pre2, second, tail = ""] = m;
    let a = money(first);
    const b = money(second);
    if (!a || !b) continue;
    // "$150-200K": the K on the second end covers a bare first end too (#682).
    if (a < 1000 && /k$/i.test(second) && !/k$/i.test(first)) a *= 1000;
    const unit = payUnit(`${firstUnit ?? ""} ${tail}`);
    const named = PREFIX[(pre1 ?? pre2 ?? "").toLowerCase()] ?? code?.toUpperCase();
    const currency = named ?? (/CAD/.test(tail) ? "CAD" : /AUD/.test(tail) ? "AUD" : /EUR|€/.test(tail) ? "EUR" : /GBP|£/.test(tail) ? "GBP" : "USD");
    const p = annual(a, b, unit, currency, "text");
    if (p) return p;
  }
  return null;
}

/** Pay from a fetched page's HTML; `text` is the page's readable text if you already have it. */
export function findPay(html: string, text?: string): Pay | null {
  return fromJsonLd(html) ?? fromGreenhouse(html) ?? fromText(text ?? html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "));
}

export const payLine = (p: Pay) => `PAY ON PAGE (${p.source}): ${p.currency} ${p.min.toLocaleString("en-US")} to ${p.max.toLocaleString("en-US")} a year`;
