import { desc, eq, gte, isNull, sql } from "drizzle-orm";
import { adminRoute, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { isAdmin } from "@/lib/users";
import { NEXT_MOVES } from "@/lib/onboarding";

/** Everything the admin page shows: totals, people, invites, recent runs. */
export const GET = adminRoute(async () => {
  const day = new Date(Date.now() - 864e5);
  const week = new Date(Date.now() - 7 * 864e5);
  const month = new Date(Date.now() - 30 * 864e5);
  // Raw SQL fragments need strings, and the users id must be table-qualified inside the subqueries.
  const monthIso = month.toISOString();
  const usd = sql<string>`coalesce(sum(${schema.runs.costUsd}), 0)`;

  const [[d], [w], [m]] = await Promise.all([
    db.select({ usd }).from(schema.runs).where(gte(schema.runs.startedAt, day)),
    db.select({ usd }).from(schema.runs).where(gte(schema.runs.startedAt, week)),
    db.select({ usd }).from(schema.runs).where(gte(schema.runs.startedAt, month)),
  ]);

  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      isAdminFlag: schema.users.isAdmin,
      disabled: schema.users.disabled,
      createdAt: schema.users.createdAt,
      lastLoginAt: schema.users.lastLoginAt,
      finds: sql<number>`(select count(*)::int from ${schema.userOpportunities} uo where uo.user_id = "users"."id")`,
      runs30: sql<number>`(select count(*)::int from ${schema.runs} r where r.user_id = "users"."id" and r.started_at >= ${monthIso})`,
      usd30: sql<string>`(select coalesce(sum(r.cost_usd), 0) from ${schema.runs} r where r.user_id = "users"."id" and r.started_at >= ${monthIso})`,
      lastRunAt: sql<string | null>`(select max(r.started_at) from ${schema.runs} r where r.user_id = "users"."id")`,
    })
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt));

  const emails = new Set(users.map((u) => u.email.toLowerCase()));
  const invites = (
    await db.select().from(schema.invites).where(isNull(schema.invites.revokedAt)).orderBy(desc(schema.invites.createdAt))
  ).map((i) => ({ email: i.email, createdAt: i.createdAt, accepted: emails.has(i.email) }));

  const runs = await db
    .select({
      id: schema.runs.id,
      email: schema.users.email,
      trigger: schema.runs.trigger,
      status: schema.runs.status,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
      found: schema.runs.found,
      added: schema.runs.added,
      searches: schema.runs.searches,
      costUsd: schema.runs.costUsd,
      error: schema.runs.error,
    })
    .from(schema.runs)
    .innerJoin(schema.users, eq(schema.users.id, schema.runs.userId))
    .orderBy(desc(schema.runs.startedAt))
    .limit(50);

  const requests = await db
    .select()
    .from(schema.accessRequests)
    .where(eq(schema.accessRequests.status, "pending"))
    .orderBy(desc(schema.accessRequests.createdAt));

  return json({
    requests: requests.map((r) => ({ email: r.email, nextMove: NEXT_MOVES.find((m) => m.key === r.nextMove)?.label ?? null, createdAt: r.createdAt })),
    totals: { users: users.length, usdDay: Number(d.usd), usdWeek: Number(w.usd), usdMonth: Number(m.usd) },
    emailEnabled: !!env.smtpUrl,
    users: users.map(({ isAdminFlag, ...u }) => ({ ...u, isAdmin: isAdmin({ isAdmin: isAdminFlag, email: u.email }), usd30: Number(u.usd30) })),
    invites,
    runs: runs.map((r) => ({ ...r, costUsd: Number(r.costUsd) })),
  });
});
