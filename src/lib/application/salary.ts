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

export const isSalaryQuestion = (prompt: string) => /salary|compensation|pay (expectation|requirement)|expected (base|annual|pay)|desired (base|pay)/i.test(prompt) && !/history|current|previous|last/i.test(prompt);

export function suggestSalary(i: { floor?: unknown; target?: unknown; min?: number | null; max?: number | null; totalCash?: boolean; asksBase?: boolean }): { amount: string; note: string } | null {
  const floor = parse(i.floor);
  const target = parse(i.target);
  const lo = i.min ?? i.max ?? null;
  const hi = i.max ?? i.min ?? null;
  if (!lo || !hi) {
    const pick = target ?? floor;
    return pick ? { amount: usd(pick), note: `The posting gives no range, so this is your ${target ? "target" : "floor"}.` } : null;
  }
  const range = `${usd(lo)} – ${usd(hi)}${i.totalCash ? " total cash including bonus" : ""}`;
  if (floor && floor > hi) return { amount: usd(floor), note: `Your floor (${usd(floor)}) is above their posted max (${range}), so this is your floor. This role may not meet your minimum.` };
  const topQuarter = round5k(lo + 0.75 * (hi - lo));
  const amount = Math.min(hi, Math.max(topQuarter, floor ?? 0, target ?? 0));
  const why = amount === hi && target && target >= hi ? "their posted max, since your target is at or above it" : target && amount === target ? "your target, which sits inside their range" : "the top quarter of their range";
  const base = i.totalCash && i.asksBase ? " Their range includes a target bonus and this question asks for base; base usually sits lower, so adjust if you know the split." : "";
  return {
    amount: usd(amount),
    note: `Their range is ${range}. This is ${why}: asking near the top leaves room to negotiate and stays inside their budget${floor ? `, and it's above your floor (${usd(floor)})` : ""}.${base}`,
  };
}
