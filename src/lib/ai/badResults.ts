import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** A find added this long after its run finished still counts as that run's (same slack as findsOfRun in quality.ts). */
const SLACK_MS = 60_000;

/**
 * The week's bad results for the AI review (#994): failed runs, failed applications, and finds the person marked
 * "Not a fit", highest score first (the model liked them most, so they are the worst misses).
 * Each carries `traceId`: the trace_id the calls went out under (#985), to look up in PostHog.
 * Staging traces carry the prompt and reply text; prod traces don't (Privacy Mode).
 */
export async function badResultsSince(since: Date, limit = 50) {
  const r = schema.runs;
  const failedRuns = await db
    .select({ traceId: r.id, trigger: r.trigger, error: r.error, step: sql<string>`${r.progress}->>'step'`, startedAt: r.startedAt })
    .from(r)
    .where(and(eq(r.status, "failed"), gt(r.startedAt, since)))
    .orderBy(desc(r.startedAt))
    .limit(limit);

  const a = schema.applications;
  const failedApps = await db
    .select({ traceId: a.id, ats: a.ats, route: a.route, error: sql<string | null>`${a.report}->>'error'`, at: a.updatedAt })
    .from(a)
    .where(and(eq(a.status, "failed"), gt(a.updatedAt, since)))
    .orderBy(desc(a.updatedAt))
    .limit(limit);

  const u = schema.userOpportunities;
  const o = schema.opportunities;
  const rejected = await db
    .select({
      userId: u.userId,
      searchId: u.searchId,
      opportunityId: u.opportunityId,
      company: o.company,
      title: o.title,
      score: u.score,
      reasonsMatch: u.reasonsMatch,
      reason: sql<string>`${u.feedback}->>'reason'`,
      addedAt: u.addedAt,
    })
    .from(u)
    .innerJoin(o, eq(o.id, u.opportunityId))
    .where(and(eq(u.addedVia, "agent"), isNotNull(u.feedback), sql`(${u.feedback}->>'at')::timestamptz > ${since.toISOString()}::timestamptz`))
    .orderBy(desc(u.score), desc(u.addedAt))
    .limit(limit);

  const searchIds = [...new Set(rejected.map((f) => f.searchId))];
  const runs = searchIds.length
    ? await db.select({ id: r.id, searchId: r.searchId, startedAt: r.startedAt, finishedAt: r.finishedAt }).from(r).where(inArray(r.searchId, searchIds))
    : [];
  // No user id goes out: the trace already carries the hashed person id.
  const notAFit = rejected.map((f) => ({
    opportunityId: f.opportunityId,
    company: f.company,
    title: f.title,
    score: f.score,
    reasonsMatch: f.reasonsMatch,
    reason: f.reason,
    addedAt: f.addedAt,
    traceId: runOf(f.addedAt, runs.filter((x) => x.searchId === f.searchId)),
  }));

  return { since: since.toISOString(), failedRuns, failedApps, notAFit };
}

/** The run that added a find: it started before the find and finished at most a minute before it. Null when none fits. */
export function runOf(addedAt: Date, runs: { id: string; startedAt: Date; finishedAt: Date | null }[]) {
  const t = addedAt.getTime();
  const hit = runs
    .filter((x) => x.startedAt.getTime() <= t && (!x.finishedAt || t <= x.finishedAt.getTime() + SLACK_MS))
    .sort((x, y) => y.startedAt.getTime() - x.startedAt.getTime())[0];
  return hit?.id ?? null;
}
