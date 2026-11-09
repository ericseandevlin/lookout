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
        const v = (bs.value ?? {}) as Record<string, unknown>;
        const min = Number(v.minValue ?? v.value), max = Number(v.maxValue ?? v.value);
        if (Number.isFinite(min) && Number.isFinite(max) && min > 0) {
          const p = annual(min, max, String(v.unitText ?? "YEAR"), String(bs.currency ?? "USD"), "structured data");
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
const RANGE = new RegExp(String.raw`\$\s?(${AMT})\s*(?:-|–|—|to)\s*\$?\s?(${AMT})([^\n]{0,40})`, "g");

// What the range is per, from the words after it. A stated year wins, so "per year, paid monthly" stays yearly (#484).
const UNITS: [string, RegExp][] = [
  ["YEAR", /\/\s?y(?:ea)?r\b|\b(?:per|a|an|each) year\b|\bannual(?:ly)?\b|\byearly\b/i],
  ["HOUR", /\/\s?h(?:ou)?r\b|\/\s?h\b|\b(?:per|a|an|each) hour\b|\bhourly\b/i],
  ["WEEK", /\/\s?w(?:ee)?k\b|\b(?:per|a|each) week\b|\bweekly\b/i],
  ["MONTH", /\/\s?mo(?:nth)?\b|\b(?:per|a|each) month\b|\bmonthly\b/i],
];
const payUnit = (tail: string) => UNITS.find(([, re]) => re.test(tail))?.[0] ?? "YEAR";

function fromText(text: string): Pay | null {
  for (const m of text.matchAll(RANGE)) {
    const a = money(m[1]), b = money(m[2]);
    if (!a || !b) continue;
    const tail = m[3] ?? "";
    const unit = payUnit(tail);
    const p = annual(a, b, unit, /CAD/.test(tail) ? "CAD" : /EUR|€/.test(tail) ? "EUR" : /GBP|£/.test(tail) ? "GBP" : "USD", "text");
    if (p) return p;
  }
  return null;
}

/** Pay from a fetched page's HTML; `text` is the page's readable text if you already have it. */
export function findPay(html: string, text?: string): Pay | null {
  return fromJsonLd(html) ?? fromGreenhouse(html) ?? fromText(text ?? html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "));
}

export const payLine = (p: Pay) => `PAY ON PAGE (${p.source}): ${p.currency} ${p.min.toLocaleString("en-US")} to ${p.max.toLocaleString("en-US")} a year`;
