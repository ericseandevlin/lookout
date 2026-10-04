import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
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

export async function startRun(userId: string, trigger: (typeof schema.runs.$inferInsert)["trigger"]) {
  const [run] = await db.insert(schema.runs).values({ userId, trigger }).returning();
  return run;
}

export async function finishRun(id: string, u: Usage, r: { found?: number; added?: number; error?: string | null }) {
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
    })
    .where(eq(schema.runs.id, id));
}
