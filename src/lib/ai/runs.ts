import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { RunReport } from "@/lib/db/schema";
import { getAccessConfig } from "@/lib/config";
import { alertDailyCap } from "@/lib/spendAlerts";
import { USER_CAP_MESSAGE } from "@/lib/spend";
import type { Usage } from "./llm";

/** A spend cap stopped AI work: "all" is the app-wide cap, "user" is this person's own (#990). */
export class BudgetError extends Error {
  constructor(message: string, readonly scope: "all" | "user" = "all") {
    super(message);
  }
}

type Db = Pick<typeof db, "select">;
type Trigger = (typeof schema.runs.$inferInsert)["trigger"];

/** A run started this long ago and still "running" is stuck; the scheduler marks it failed (same window, #1038). */
const IN_FLIGHT_MS = 45 * 60_000;
/** A running run counts at the average cost of this many recent finished runs of its trigger (#1038). */
const ESTIMATE_RUNS = 20;
/** Serializes the cap check and the run insert, so concurrent starts can't all pass on the same total (#1038). */
const BUDGET_LOCK_ID = 7_431_038;

/**
 * Spend in the last 24 hours: what finished runs cost, plus an estimate for each run still going, which has no
 * cost written yet. Without the estimate three scheduler slots could each start on a total that counts the
 * others as $0 (#1038).
 */
export async function spentSince(since: Date, userId?: string, d: Db = db) {
  const cutoff = new Date(Date.now() - IN_FLIGHT_MS);
  const inFlight = sql<boolean>`(${schema.runs.status} = 'running' and ${schema.runs.startedAt} > ${cutoff.toISOString()}::timestamptz)`;
  const isMine = userId ? sql<boolean>`(${schema.runs.userId} = ${userId})` : sql<boolean>`false`;
  // A handful of rows: finished cost and in-flight count, per trigger, split by this person or not.
  const groups = await d
    .select({
      trigger: schema.runs.trigger,
      mine: isMine,
      usd: sql<string>`coalesce(sum(${schema.runs.costUsd}), 0)`,
      inFlight: sql<number>`count(*) filter (where ${inFlight})`.mapWith(Number),
    })
    .from(schema.runs)
    .where(gte(schema.runs.startedAt, since))
    .groupBy(schema.runs.trigger, isMine);
  const estimates = new Map<string, number>();
  for (const trigger of new Set(groups.filter((g) => g.inFlight > 0).map((g) => g.trigger))) {
    const recent = d
      .select({ usd: schema.runs.costUsd })
      .from(schema.runs)
      .where(and(eq(schema.runs.trigger, trigger), eq(schema.runs.status, "done")))
      .orderBy(desc(schema.runs.finishedAt))
      .limit(ESTIMATE_RUNS)
      .as("recent");
    const [{ usd }] = await d.select({ usd: sql<string | null>`avg(${recent.usd})` }).from(recent);
    estimates.set(trigger, Number(usd ?? 0));
  }
  let all = 0;
  let mine = 0;
  for (const g of groups) {
    // A running run's own cost stays 0 until it finishes, so its estimate simply adds on.
    const usd = Number(g.usd) + g.inFlight * (estimates.get(g.trigger) ?? 0);
    all += usd;
    if (g.mine) mine += usd;
  }
  return { all, mine };
}

/** Refuse new AI work once the rolling 24h spend (all users, or this user) reaches its cap. The app-wide cap emails the admins (#990). */
export async function assertBudget(userId: string, d: Db = db) {
  const cfg = await getAccessConfig();
  const { all, mine } = await spentSince(new Date(Date.now() - 24 * 3600_000), userId, d);
  if (all >= cfg.dailyBudgetUsd) {
    await alertDailyCap(all);
    throw new BudgetError("Lookout hit its daily spend cap. Try again tomorrow.");
  }
  if (mine >= cfg.userDailyBudgetUsd) throw new BudgetError(USER_CAP_MESSAGE, "user");
}

type RunOpts = { searchId?: string; status?: "queued" | "running"; request?: Record<string, unknown> };

export async function startRun(userId: string, trigger: Trigger, opts: RunOpts = {}, d: Pick<typeof db, "insert"> = db) {
  const [run] = await d
    .insert(schema.runs)
    .values({ userId, trigger, ...(opts.searchId && { searchId: opts.searchId }), status: opts.status ?? "running", request: opts.request })
    .returning();
  return run;
}

/**
 * Check the caps and start the run as one step. Starts wait their turn on a lock, so each check sees the runs
 * started before it (counted at their estimate) and three at once can't pass on the same total (#1038).
 */
export async function startBudgetedRun(userId: string, trigger: Trigger, opts: RunOpts = {}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BUDGET_LOCK_ID})`);
    await assertBudget(userId, tx);
    return startRun(userId, trigger, opts, tx);
  });
}

export async function finishRun(id: string, u: Usage, r: { found?: number; added?: number; error?: string | null; report?: RunReport }) {
  await db
    .update(schema.runs)
    .set({
      status: r.error ? "failed" : "done",
      finishedAt: new Date(),
      found: r.found ?? 0,
      added: r.added ?? 0,
      error: r.error ? r.error.slice(0, 1000) : null,
      inputTokens: u.input,
      outputTokens: u.output,
      searches: u.searches,
      costUsd: u.usd.toFixed(4),
      ...(r.report && { report: r.report }),
    })
    .where(eq(schema.runs.id, id));
}

/**
 * Report progress for the live search panel. Keeps the last 40 steps.
 * `log: false` updates the percent and current step without adding a log line.
 */
export async function progress(runId: string, pct: number, step: string, opts: { log?: boolean } = {}) {
  const entry = JSON.stringify([{ at: new Date().toISOString(), text: step }]);
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  await db
    .update(schema.runs)
    .set({
      progress:
        opts.log === false
          ? sql`jsonb_set(jsonb_set(${schema.runs.progress}, '{pct}', ${String(p)}::jsonb), '{step}', to_jsonb(${step}::text))`
          : sql`jsonb_build_object('pct', ${p}::int, 'step', ${step}::text, 'log',
              (select coalesce(jsonb_agg(e), '[]'::jsonb) from (
                select e from jsonb_array_elements(coalesce(${schema.runs.progress}->'log', '[]'::jsonb) || ${entry}::jsonb) e
                offset greatest(jsonb_array_length(coalesce(${schema.runs.progress}->'log', '[]'::jsonb)) + 1 - 40, 0)
              ) t))`,
    })
    .where(eq(schema.runs.id, runId));
}
