/** Pure rules for spend alerts and month-to-date spend (#990). */

/** What the person sees when their own daily cap stopped a search. */
export const USER_CAP_MESSAGE = "You reached your daily AI spend limit, so Lookout paused your searches and drafts. They start again on their own within 24 hours.";

/** The AI key's spend this month against its limit, in USD. `reset` is OpenRouter's limit_reset ("monthly", or null). */
export type KeyUsage = { usd: number; limit: number; reset: string | null };

/** Share of the key's monthly limit that triggers the admin email. */
export const KEY_ALERT_AT = 0.7;

/** "2026-11" in UTC, the month OpenRouter resets key limits on. */
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** The first moment of the UTC month. */
export const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** "2026-11-13" in the app's time zone, so the daily-cap alert goes out at most once a local day. */
export const dayKey = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Send the key alert when spend reaches 70% of the limit and it hasn't gone out this month. */
export function keyAlertDue(u: KeyUsage, sentMonth: string | undefined, month: string) {
  return u.limit > 0 && u.usd >= u.limit * KEY_ALERT_AT && sentMonth !== month;
}

/** Spend per person active this month, or null with nobody active. */
export const perActive = (usd: number, actives: number) => (actives > 0 ? usd / actives : null);
