import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ApplicationStatus, AutoApplySettings } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/users";

/** Auto-apply is a beta. For now only admins see it, so Eric can build it on his own account first. */
export const canUseAutoApply = (user: SessionUser) => isAdmin(user);

export const DEFAULT_AUTO_APPLY: AutoApplySettings = { enabled: false, threshold: 5, dailyCap: 3 };

export async function getAutoApplySettings(userId: string): Promise<AutoApplySettings> {
  const [s] = await db.select({ a: schema.settings.autoApply }).from(schema.settings).where(eq(schema.settings.userId, userId));
  return { ...DEFAULT_AUTO_APPLY, ...(s?.a ?? {}) };
}

export async function saveAutoApplySettings(userId: string, patch: Partial<AutoApplySettings>) {
  const next = { ...(await getAutoApplySettings(userId)), ...patch };
  await db
    .insert(schema.settings)
    .values({ userId, autoApply: next })
    .onConflictDoUpdate({ target: schema.settings.userId, set: { autoApply: next } });
  return next;
}

export type ApplicationRow = {
  id: string;
  findId: string;
  company: string;
  role: string;
  url: string | null;
  score: number | null;
  status: ApplicationStatus;
  queuedBy: "user" | "auto";
  ats: string | null;
  createdAt: string;
  submittedAt: string | null;
};

export async function listApplications(userId: string): Promise<ApplicationRow[]> {
  const rows = await db
    .select({ a: schema.applications, o: schema.opportunities, u: schema.userOpportunities })
    .from(schema.applications)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.applications.opportunityId))
    .leftJoin(
      schema.userOpportunities,
      and(eq(schema.userOpportunities.opportunityId, schema.applications.opportunityId), eq(schema.userOpportunities.userId, userId)),
    )
    .where(eq(schema.applications.userId, userId))
    .orderBy(desc(schema.applications.createdAt));
  return rows.map(({ a, o, u }) => ({
    id: a.id,
    findId: o.id,
    company: o.company,
    role: o.title,
    url: o.sourceUrl,
    score: u?.score ?? null,
    status: a.status,
    queuedBy: a.queuedBy,
    ats: a.ats,
    createdAt: a.createdAt.toISOString(),
    submittedAt: a.submittedAt?.toISOString() ?? null,
  }));
}

/** Queue a find for auto-apply. Idempotent: queuing the same find again returns the existing application. */
export async function queueApplication(userId: string, opportunityId: string, by: "user" | "auto") {
  const [onBoard] = await db
    .select({ id: schema.userOpportunities.opportunityId })
    .from(schema.userOpportunities)
    .where(and(eq(schema.userOpportunities.userId, userId), eq(schema.userOpportunities.opportunityId, opportunityId)));
  if (!onBoard) return null;
  const [row] = await db
    .insert(schema.applications)
    .values({ userId, opportunityId, queuedBy: by })
    .onConflictDoUpdate({
      target: [schema.applications.userId, schema.applications.opportunityId],
      // Re-queuing a canceled one brings it back; anything further along is left as is.
      set: { updatedAt: new Date() },
    })
    .returning();
  if (row.status === "canceled") {
    await db.update(schema.applications).set({ status: "queued", queuedBy: by, updatedAt: new Date() }).where(eq(schema.applications.id, row.id));
    row.status = "queued";
  }
  return row;
}

/**
 * After a search: queue the new finds that meet the user's auto-apply threshold, best first,
 * within the daily cap. Only for users who have the beta and turned it on.
 */
export async function autoQueue(userId: string, newFinds: { id: string; score: number }[]) {
  if (!newFinds.length) return 0;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || !canUseAutoApply(user)) return 0;
  const s = await getAutoApplySettings(userId);
  if (!s.enabled) return 0;
  const since = new Date(Date.now() - 24 * 3600_000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.applications)
    .where(and(eq(schema.applications.userId, userId), eq(schema.applications.queuedBy, "auto"), gte(schema.applications.createdAt, since)));
  const room = Math.max(0, s.dailyCap - n);
  const picks = newFinds.filter((f) => f.score >= s.threshold).sort((a, b) => b.score - a.score).slice(0, room);
  for (const f of picks) await queueApplication(userId, f.id, "auto");
  return picks.length;
}
