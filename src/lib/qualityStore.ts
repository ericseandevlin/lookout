import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { byWeek, findsOfRun, outcome, topReasons, type FindRow } from "./quality";

const DAYS = 90;

/** Finds quality for Admin (#31): per person, per week, per recent search, and the "Not a fit" reasons. Finds Lookout added in the last 90 days. */
export async function findsQuality() {
  const since = new Date(Date.now() - DAYS * 864e5);
  const raw = await db
    .select({
      userId: schema.userOpportunities.userId,
      addedAt: schema.userOpportunities.addedAt,
      seenAt: schema.userOpportunities.seenAt,
      pinned: schema.userOpportunities.pinned,
      stage: schema.userOpportunities.stage,
      feedback: schema.userOpportunities.feedback,
    })
    .from(schema.userOpportunities)
    .where(and(eq(schema.userOpportunities.addedVia, "agent"), gte(schema.userOpportunities.addedAt, since)));
  const rows: FindRow[] = raw;
  const users = await db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name }).from(schema.users);
  const runs = await db
    .select({ id: schema.runs.id, userId: schema.runs.userId, trigger: schema.runs.trigger, startedAt: schema.runs.startedAt, finishedAt: schema.runs.finishedAt, added: schema.runs.added })
    .from(schema.runs)
    .where(and(eq(schema.runs.status, "done"), inArray(schema.runs.trigger, ["scheduled", "manual"]), gte(schema.runs.startedAt, since)))
    .orderBy(desc(schema.runs.startedAt))
    .limit(25);

  const who = new Map(users.map((u) => [u.id, u.name || u.email]));
  const mine = new Map<string, FindRow[]>();
  for (const r of rows) mine.set(r.userId, [...(mine.get(r.userId) ?? []), r]);
  return {
    days: DAYS,
    total: outcome(rows),
    people: [...mine].map(([id, rs]) => ({ id, who: who.get(id) ?? "Deleted account", ...outcome(rs) })).sort((a, b) => b.added - a.added),
    weeks: byWeek(rows, 8),
    reasons: topReasons(rows),
    searches: runs.map((r) => ({ id: r.id, who: who.get(r.userId) ?? "Deleted account", trigger: r.trigger, at: r.startedAt.toISOString(), ...outcome(findsOfRun(r, rows)) })),
  };
}
