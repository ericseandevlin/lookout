/**
 * Current compensation (#109): one yearly number the person enters on their profile, compared against a posting's
 * stated range on their own board. Stored encrypted, never sent to a model, never in drafts, exports or imports.
 * The comparison uses only the stated range and the saved number: no benchmarks, no estimates, no currency conversion.
 */
export const CURRENT_COMP_CURRENCY = "USD";
export const CURRENT_COMP_MIN = 1_000;
export const CURRENT_COMP_MAX = 10_000_000;

export type CompCompare =
  | { kind: "not-stated" }
  | { kind: "other-currency"; currency: string }
  | { kind: "above"; pct: number }
  | { kind: "within" }
  | { kind: "below"; pct: number };

/** "$150,000", "150000", "150k" -> 150000. Null when it isn't a whole yearly amount in range. */
export function parseCurrentComp(s: string): number | null {
  const m = s.trim().replace(/[\s$,]/g, "").match(/^(\d+(?:\.\d+)?)([kK])?$/);
  if (!m) return null;
  const n = Math.round(Number(m[1]) * (m[2] ? 1000 : 1));
  return n >= CURRENT_COMP_MIN && n <= CURRENT_COMP_MAX ? n : null;
}

/** A posting's range against the saved number. pct is whole percent of the saved number, rounded. */
export function compareComp(range: [number, number] | null, currency: string, current: number): CompCompare {
  if (!range) return { kind: "not-stated" };
  if (currency !== CURRENT_COMP_CURRENCY) return { kind: "other-currency", currency };
  const lo = Math.min(...range), hi = Math.max(...range);
  if (lo > current) return { kind: "above", pct: Math.round(((lo - current) / current) * 100) };
  if (hi < current) return { kind: "below", pct: Math.round(((current - hi) / current) * 100) };
  return { kind: "within" };
}

export function compareText(c: CompCompare): string {
  switch (c.kind) {
    case "not-stated":
      return "Range not stated";
    case "other-currency":
      return `Range in ${c.currency}, not compared`;
    case "above":
      return c.pct > 0 ? `Starts ${c.pct}% above your current pay` : "Starts just above your current pay";
    case "below":
      return c.pct > 0 ? `Tops out ${c.pct}% below your current pay` : "Tops out just below your current pay";
    case "within":
      return "Your current pay is inside this range";
  }
}

export const COMPARE_INK: Record<CompCompare["kind"], string> = {
  "not-stated": "#A89F92",
  "other-currency": "#A89F92",
  above: "#35662A",
  within: "#6B6358",
  below: "#99220F",
};
