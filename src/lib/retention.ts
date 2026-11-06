import "server-only";
import { and, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Run logs and reports are kept 12 months; the run row and its counts stay for cost totals (#26). */
export const RUN_LOG_DAYS = 365;

/** Delete what has no use any more: expired sign-in links and sessions, and old run logs. Returns counts. */
export async function cleanup(now = new Date()) {
  const tokens = await db.delete(schema.loginTokens).where(lt(schema.loginTokens.expiresAt, now)).returning({ h: schema.loginTokens.tokenHash });
  const sessions = await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).returning({ h: schema.sessions.idHash });
  const cutoff = new Date(now.getTime() - RUN_LOG_DAYS * 86_400_000);
  const runs = await db
    .update(schema.runs)
    .set({ progress: { pct: 100, step: "", log: [] }, report: null, request: null })
    .where(
      and(
        lt(schema.runs.startedAt, cutoff),
        or(sql`${schema.runs.report} is not null`, sql`${schema.runs.request} is not null`, sql`jsonb_array_length(${schema.runs.progress}->'log') > 0`),
      ),
    )
    .returning({ id: schema.runs.id });
  return { loginTokens: tokens.length, sessions: sessions.length, runLogs: runs.length };
}
