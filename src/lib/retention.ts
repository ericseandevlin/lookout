import "server-only";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { inactiveEmail, sendMail } from "@/lib/email";
import { env } from "@/lib/env";
import { pruneErrors } from "@/lib/errorLog";

/** Run logs and reports are kept 12 months; the run row and its counts stay for cost totals (#26). */
export const RUN_LOG_DAYS = 365;

/** Accounts unused this long get one email (#26). Eric decided (2026-11-07) deletion stays by hand. */
export const INACTIVE_DAYS = 365;

/** Delete what has no use any more: expired sign-in links and sessions, old run logs and old server errors (#12), then warn idle accounts. Returns counts. */
export async function cleanup(now = new Date()) {
  const tokens = await db.delete(schema.loginTokens).where(lt(schema.loginTokens.expiresAt, now)).returning({ h: schema.loginTokens.tokenHash });
  // Keep when each expiring session was last used, so a long idle stretch is measured from real use.
  await db.execute(sql`update ${schema.users} u set last_active_at = greatest(u.last_active_at, s.seen)
    from (select user_id, max(last_seen_at) as seen from ${schema.sessions} where expires_at < ${now.toISOString()}::timestamptz group by user_id) s
    where u.id = s.user_id and s.seen is not null`);
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
  const errors = await pruneErrors(now);
  const inactiveWarned = await warnInactive(now);
  return { loginTokens: tokens.length, sessions: sessions.length, runLogs: runs.length, errors, inactiveWarned };
}

/**
 * Email each account that hasn't been used in 12 months, once per idle stretch. Last use is the
 * latest of sign-up, sign-in and the last request on any session, live or deleted. Disabled accounts are skipped.
 */
export async function warnInactive(now = new Date()) {
  const cutoff = new Date(now.getTime() - INACTIVE_DAYS * 86_400_000);
  const u = schema.users;
  const lastUsed = sql`greatest(${u.createdAt}, ${u.lastLoginAt}, ${u.lastActiveAt}, (select max(${schema.sessions.lastSeenAt}) from ${schema.sessions} where ${schema.sessions.userId} = ${u.id}))`;
  const idle = await db
    .select({ id: u.id, email: u.email })
    .from(u)
    .where(and(eq(u.disabled, false), sql`${lastUsed} < ${cutoff.toISOString()}::timestamptz`, or(sql`${u.inactiveWarnedAt} is null`, sql`${u.inactiveWarnedAt} < ${lastUsed}`)));
  let sent = 0;
  for (const a of idle) {
    try {
      await sendMail(inactiveEmail(a.email, `${env.appUrl}/`));
    } catch (e) {
      console.error(`[retention] inactive email to account ${a.id} failed`, e);
      continue;
    }
    await db.update(u).set({ inactiveWarnedAt: now }).where(eq(u.id, a.id));
    sent++;
  }
  return sent;
}
