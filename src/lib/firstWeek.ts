import { DAYS } from "./board";
import type { Settings } from "./types";

/** How long after joining the board shows the first-week tips (#992). */
export const FIRST_WEEK_DAYS = 7;

/** True while someone is in their first week, counted from when the account was made. */
export function inFirstWeek(joinedAt: string, now = Date.now()) {
  const t = new Date(joinedAt).getTime();
  return Number.isFinite(t) && now - t < FIRST_WEEK_DAYS * 864e5;
}

/** The search schedule in words, e.g. "every Monday", "Monday and Thursday", "every day". */
export function scheduleLabel(s: Pick<Settings, "freq" | "day" | "days">) {
  if (s.freq === "Daily") return "every day";
  if (s.freq === "Twice a week") return s.days.map((d) => DAYS[d] ?? d).join(" and ");
  return `every ${DAYS[s.day] ?? s.day}`;
}
