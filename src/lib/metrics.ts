/**
 * Admin > Metrics (#36): the beta goals from ROADMAP > Goals, computed from product events and
 * the board. Pure functions here; the queries are in metricsStore.ts.
 */
import { weekOf } from "./events";

export type MetricEvent = { userId: string; type: string; target: string | null; meta: Record<string, unknown> | null; at: Date };

const WEEK = 7 * 864e5;
const APPLIED = new Set(["Applied", "Interview", "Offer", "Not selected", "Ghosted"]);

/** Beta goals, through January 10, 2027 (ROADMAP > Goals). */
export const GOALS = { weeklyActives: 5, actedPerActive: 1, interviews: 1, week4Retention: 0.6, costPerActiveMonth: 1 };

/**
 * The find an event acted on, or null. Acting on a find: opened the posting, pinned it, moved it to
 * Applied or later, or clicked it from email (the email's board link isn't a find).
 */
export function actedOn(e: MetricEvent): string | null {
  if (!e.target) return null;
  if (e.type === "posting_clicked") return e.target;
  if (e.type === "pin") return e.meta?.on === false ? null : e.target;
  if (e.type === "email_click") return e.target === "board" ? null : e.target;
  if (e.type === "stage_change") return APPLIED.has(String(e.meta?.stage)) ? e.target : null;
  return null;
}

/** Per week, oldest first: active people and distinct finds acted on per active person. Heartbeats don't count. */
export function weekly(events: MetricEvent[], weeks: number, now = new Date()) {
  const keys: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) keys.push(weekOf(new Date(now.getTime() - i * WEEK)));
  const active = new Map(keys.map((k) => [k, new Set<string>()]));
  const acted = new Map(keys.map((k) => [k, new Set<string>()]));
  for (const e of events) {
    if (e.type === "heartbeat") continue;
    const w = weekOf(e.at);
    active.get(w)?.add(e.userId);
    const find = actedOn(e);
    if (find) acted.get(w)?.add(`${e.userId}:${find}`);
  }
  return keys.map((week) => {
    const people = active.get(week)!.size;
    const finds = acted.get(week)!.size;
    return { week, active: people, acted: finds, actedPerActive: people ? finds / people : 0 };
  });
}

/**
 * Week-4 retention: of people whose fourth week (counting the week of their first event as week 1)
 * is over, the share who did anything in that week.
 */
export function week4Retention(events: MetricEvent[], now = new Date()) {
  const first = new Map<string, number>();
  const weeksOf = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.type === "heartbeat") continue;
    const t = new Date(`${weekOf(e.at)}T00:00:00Z`).getTime();
    if (!first.has(e.userId) || t < first.get(e.userId)!) first.set(e.userId, t);
    if (!weeksOf.has(e.userId)) weeksOf.set(e.userId, new Set());
    weeksOf.get(e.userId)!.add(weekOf(e.at));
  }
  const thisWeek = new Date(`${weekOf(now)}T00:00:00Z`).getTime();
  let eligible = 0;
  let retained = 0;
  for (const [user, start] of first) {
    const w4 = start + 3 * WEEK;
    if (w4 >= thisWeek) continue;
    eligible++;
    if (weeksOf.get(user)!.has(new Date(w4).toISOString().slice(0, 10))) retained++;
  }
  return { eligible, retained, rate: eligible ? retained / eligible : null };
}

/** Distinct people with any event (not heartbeats) since a date. */
export function activeSince(events: MetricEvent[], since: Date) {
  return new Set(events.filter((e) => e.type !== "heartbeat" && e.at >= since).map((e) => e.userId)).size;
}
