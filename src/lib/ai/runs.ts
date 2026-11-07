import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { RunReport } from "@/lib/db/schema";
import { getAccessConfig } from "@/lib/config";
import type { Usage } from "./llm";

export class BudgetError extends Error {}

/** Refuse new AI work once the rolling 24h spend (all users, or this user) reaches its cap. */
export async function assertBudget(userId: string) {
  const cfg = await getAccessConfig();
  const since = new Date(Date.now() - 24 * 3600_000);
  const total = sql<string>`coalesce(sum(${schema.runs.costUsd}), 0)`;
  const [all] = await db.select({ usd: total }).from(schema.runs).where(gte(schema.runs.startedAt, since));
  if (Number(all.usd) >= cfg.dailyBudgetUsd) throw new BudgetError("Lookout hit its daily spend cap. Try again tomorrow.");
  const [mine] = await db
    .select({ usd: total })
    .from(schema.runs)
    .where(and(eq(schema.runs.userId, userId), gte(schema.runs.startedAt, since)));
  if (Number(mine.usd) >= cfg.userDailyBudgetUsd) throw new BudgetError("You've hit today's search limit. Try again tomorrow.");
}

export async function startRun(
  userId: string,
  trigger: (typeof schema.runs.$inferInsert)["trigger"],
  opts: { searchId?: string; status?: "queued" | "running"; request?: Record<string, unknown> } = {},
) {
  const [run] = await db
    .insert(schema.runs)
    .values({ userId, trigger, ...(opts.searchId && { searchId: opts.searchId }), status: opts.status ?? "running", request: opts.request })
    .returning();
  return run;
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
