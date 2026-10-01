import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

let client: Anthropic | null = null;
export const claude = () => (client ??= new Anthropic());

// $ per million tokens. Unknown models fall back to Opus pricing so caps stay conservative.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};
const SEARCH_USD = 0.01; // per web search call

export type Usage = { input: number; output: number; searches: number; usd: number };
export const emptyUsage = (): Usage => ({ input: 0, output: 0, searches: 0, usd: 0 });

type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

export function addUsage(acc: Usage, model: string, u: UsageLike) {
  const [pin, pout] = PRICES[model] ?? [4, 20];
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  acc.input += input;
  acc.output += u.output_tokens;
  acc.searches += searches;
  acc.usd += (input * pin + u.output_tokens * pout) / 1e6 + searches * SEARCH_USD;
}

export class BudgetError extends Error {}

/** Refuse new AI work once today's spend (all users, or this user) reaches its cap. */
export async function assertBudget(userId: string) {
  const since = new Date(Date.now() - 24 * 3600_000);
  const total = sql<string>`coalesce(sum(${schema.runs.costUsd}), 0)`;
  const [all] = await db.select({ usd: total }).from(schema.runs).where(gte(schema.runs.startedAt, since));
  if (Number(all.usd) >= env.dailyBudgetUsd) throw new BudgetError("Lookout hit its daily spend cap. Try again tomorrow.");
  const [mine] = await db
    .select({ usd: total })
    .from(schema.runs)
    .where(and(eq(schema.runs.userId, userId), gte(schema.runs.startedAt, since)));
  if (Number(mine.usd) >= env.userDailyBudgetUsd) throw new BudgetError("You've hit today's search limit. Try again tomorrow.");
}

export async function startRun(userId: string, trigger: (typeof schema.runs.$inferInsert)["trigger"]) {
  const [run] = await db.insert(schema.runs).values({ userId, trigger }).returning();
  return run;
}

export async function finishRun(
  id: string,
  u: Usage,
  r: { found?: number; added?: number; error?: string | null },
) {
  await db
    .update(schema.runs)
    .set({
      status: r.error ? "failed" : "done",
      finishedAt: new Date(),
      found: r.found ?? 0,
      added: r.added ?? 0,
      error: r.error ?? null,
      inputTokens: u.input,
      outputTokens: u.output,
      searches: u.searches,
      costUsd: u.usd.toFixed(4),
    })
    .where(eq(schema.runs.id, id));
}

/** Text of the final assistant message, minus server tool blocks. */
export function textOf(content: Anthropic.Beta.BetaContentBlock[] | Anthropic.ContentBlock[]) {
  return content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
