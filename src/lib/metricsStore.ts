import "server-only";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { actedOn, activation, activeSince, GOALS, retention, scoreSplit, searchSuccess, weekly, type MetricEvent } from "./metrics";
import { APPLIED, topReasons } from "./quality";

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
  const [{ n: interviews, offers }] = await db
    .select({ n: sql<number>`count(*)::int`, offers: sql<number>`count(*) filter (where ${schema.userOpportunities.stage} = 'Offer')::int` })
    .from(schema.userOpportunities)
    .where(inArray(schema.userOpportunities.stage, ["Interview", "Offer"]));
  const week4 = retention(events, 4, now);
  const week8 = retention(events, 8, now);

  // Activation: profile, resume and a first finished search within 7 days of joining.
  const joiners = await db
    .select({
      createdAt: schema.users.createdAt,
      profileSaved: sql<boolean>`exists (select 1 from ${schema.profiles} p where p.user_id = ${schema.users.id} and p.saved_at is not null)`,
      resume: sql<boolean>`exists (select 1 from ${schema.materials} m where m.user_id = ${schema.users.id} and m.kind = 'resume')`,
      firstSearchAt: sql<Date | null>`(select min(r.finished_at) from ${schema.runs} r where r.user_id = ${schema.users.id} and r.status = 'done' and r.trigger in ('scheduled', 'manual'))`,
    })
    .from(schema.users)
    .where(eq(schema.users.disabled, false));
  const activated = activation(joiners.map((j) => ({ ...j, firstSearchAt: j.firstSearchAt ? new Date(j.firstSearchAt) : null })), now);

  // Quality: finds Lookout added in the last 90 days, same rules as Admin > Finds quality, plus find clicks from events.
  const quarterAgo = new Date(now.getTime() - 90 * DAY);
  const finds = await db
    .select({
      userId: schema.userOpportunities.userId,
      opportunityId: schema.userOpportunities.opportunityId,
      addedAt: schema.userOpportunities.addedAt,
      seenAt: schema.userOpportunities.seenAt,
      pinned: schema.userOpportunities.pinned,
      stage: schema.userOpportunities.stage,
      feedback: schema.userOpportunities.feedback,
      score: schema.userOpportunities.score,
    })
    .from(schema.userOpportunities)
    .innerJoin(schema.users, eq(schema.users.id, schema.userOpportunities.userId))
    .where(and(eq(schema.userOpportunities.addedVia, "agent"), gte(schema.userOpportunities.addedAt, quarterAgo), eq(schema.users.disabled, false)));
  const touched = new Set<string>();
  for (const e of events) {
    const find = actedOn(e);
    if (find) touched.add(`${e.userId}:${find}`);
  }
  const rated = finds.map((f) => ({ score: f.score, acted: f.pinned || APPLIED.includes(f.stage) || touched.has(`${f.userId}:${f.opportunityId}`) }));

  const searches = await db
    .select({ status: schema.runs.status, read: sql<number | null>`(${schema.runs.report} ->> 'read')::int` })
    .from(schema.runs)
    .where(and(gte(schema.runs.startedAt, monthAgo), inArray(schema.runs.trigger, ["scheduled", "manual"])));
  const cost = Number(usd);
  return {
    goals: GOALS,
    lastWeek: last.week,
    weeklyActives: last.active,
    actedPerActive: last.actedPerActive,
    interviews,
    retention: week4,
    week8,
    activation: activated,
    offers,
    quality: { days: 90, added: finds.length, acted: rated.filter((f) => f.acted).length, notFit: finds.filter((f) => f.feedback).length, topReason: topReasons(finds, 1)[0] ?? null, score: scoreSplit(rated) },
    search: searchSuccess(searches),
    costMonth: cost,
    monthActives,
    costPerActiveMonth: monthActives ? cost / monthActives : null,
    weeks: weeks.slice(0, -1),
  };
}
