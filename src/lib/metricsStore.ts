import "server-only";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { activeSince, GOALS, week4Retention, weekly, type MetricEvent } from "./metrics";

const DAY = 864e5;

/** Admin > Metrics (#36): each beta goal with where it stands. Disabled accounts are left out. */
export async function metrics(now = new Date()) {
  const since = new Date(now.getTime() - 12 * 7 * DAY);
  const rows = await db
    .select({ userId: schema.events.userId, type: schema.events.type, target: schema.events.target, meta: schema.events.meta, at: schema.events.at })
    .from(schema.events)
    .innerJoin(schema.users, eq(schema.users.id, schema.events.userId))
    .where(and(gte(schema.events.at, since), ne(schema.events.type, "heartbeat"), eq(schema.users.disabled, false)));
  const events = rows as MetricEvent[];
  const weeks = weekly(events, 9, now);
  // The current week is still running; goals are judged on the last full week.
  const last = weeks[weeks.length - 2];
  const monthAgo = new Date(now.getTime() - 30 * DAY);
  const [{ usd }] = await db
    .select({ usd: sql<string>`coalesce(sum(${schema.runs.costUsd}), 0)` })
    .from(schema.runs)
    .where(gte(schema.runs.startedAt, monthAgo));
  const monthActives = activeSince(events, monthAgo);
  const [{ n: interviews }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.userOpportunities)
    .where(inArray(schema.userOpportunities.stage, ["Interview", "Offer"]));
  const retention = week4Retention(events, now);
  const cost = Number(usd);
  return {
    goals: GOALS,
    lastWeek: last.week,
    weeklyActives: last.active,
    actedPerActive: last.actedPerActive,
    interviews,
    retention,
    costMonth: cost,
    monthActives,
    costPerActiveMonth: monthActives ? cost / monthActives : null,
    weeks: weeks.slice(0, -1),
  };
}
