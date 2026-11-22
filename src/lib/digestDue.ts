import { daysUntil } from "./board";
import { kinds } from "@/lib/kinds";

// The stage each kind's application or bid is sent at, and every stage after it (#1539).
const SENT = new Set(
  Object.values(kinds).flatMap((k) => {
    const i = k.stages.findIndex((s) => /^(applied|submitted)$/i.test(s));
    return i < 0 ? [] : k.stages.slice(i);
  }),
);

/**
 * Whether a find still has its deadline ahead of the person: it hasn't been applied to or submitted (#1539). A job at
 * Applied, Interview or Offer, or an RFP at Submitted or Awarded, has nothing left due. A stage no kind knows stays in.
 */
export const stillDue = (stage: string | null | undefined) => !stage || !SENT.has(stage);

/** How far ahead the digest looks for deadlines (#304). */
export const DUE_SOON_DAYS = 7;

/**
 * Pinned finds whose due date falls in the next week, soonest first (#304). Past dates and finds with no date are left out.
 * timeZone: the zone "today" is counted in; the digest passes the app's (#867).
 */
export function pickDueSoon<T extends { attributes: Record<string, unknown> }>(rows: T[], now = Date.now(), timeZone?: string) {
  return rows
    .map((r) => {
      const v = r.attributes?.due;
      const days = daysUntil(typeof v === "string" ? v.trim() : "", now, timeZone);
      return { row: r, days };
    })
    .filter((x): x is { row: T; days: number } => x.days != null && x.days >= 0 && x.days <= DUE_SOON_DAYS)
    .sort((a, b) => a.days - b.days);
}

export const dueLabel = (days: number) => (days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due in ${days} days`);
