/**
 * The comp line for one find in the finds email (#492): whichever ends are posted, $ only for USD, the code otherwise.
 * "$150,000 – $200,000", "$150,000+", "Up to $200,000", "150,000 – 180,000 GBP", or null when none is posted.
 */
export function compLabel(min: number | null, max: number | null, currency = "USD"): string | null {
  if (!min && !max) return null;
  const usd = !currency || currency === "USD";
  const n = (v: number) => (usd ? "$" : "") + v.toLocaleString("en-US");
  const range = min && max ? (min === max ? n(min) : `${n(min)} – ${n(max)}`) : min ? `${n(min)}+` : `Up to ${n(max!)}`;
  return usd ? range : `${range} ${currency}`;
}
