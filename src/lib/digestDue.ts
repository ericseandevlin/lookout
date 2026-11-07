import { daysUntil } from "./board";

/** How far ahead the digest looks for deadlines (#304). */
export const DUE_SOON_DAYS = 7;

/** Pinned finds whose due date falls in the next week, soonest first (#304). Past dates and finds with no date are left out. */
export function pickDueSoon<T extends { attributes: Record<string, unknown> }>(rows: T[], now = Date.now()) {
  // Count from today's noon so a date due today reads 0, not 1, before noon.
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  return rows
    .map((r) => {
      const v = r.attributes?.due;
      const days = daysUntil(typeof v === "string" ? v.trim() : "", noon.getTime());
      return { row: r, days };
    })
    .filter((x): x is { row: T; days: number } => x.days != null && x.days >= 0 && x.days <= DUE_SOON_DAYS)
    .sort((a, b) => a.days - b.days);
}

export const dueLabel = (days: number) => (days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due in ${days} days`);
