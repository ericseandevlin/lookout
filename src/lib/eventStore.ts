import "server-only";
import { and, asc, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { answeredCount, job } from "@/lib/kinds";
import { isAdmin } from "@/lib/users";
import { funnel, nextStep, timeline, weeklyActives, type EventType, type FunnelPerson } from "./events";

/** Record an event. Never throws: analytics must not break the action it describes. */
export async function track(userId: string, type: EventType, target?: string | null, meta?: Record<string, string | number | boolean>) {
  try {
    await db.insert(schema.events).values({ userId, type, target: target?.slice(0, 300) ?? null, meta: meta ?? null });
  } catch (e) {
    console.error("[events] not recorded", type, e);
  }
}

/** Admin > Activity: weekly actives (8 weeks), the funnel from current data, and who's been around. */
export async function activity() {
  const since = new Date(Date.now() - 8 * 7 * 864e5);
  const rows = await db.select({ userId: schema.events.userId, type: schema.events.type, at: schema.events.at }).from(schema.events).where(and(gte(schema.events.at, since), ne(schema.events.type, "heartbeat")));
  const users = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, lastLoginAt: schema.users.lastLoginAt, onboardedAt: schema.users.onboardedAt, disabled: schema.users.disabled, isAdmin: schema.users.isAdmin })
    .from(schema.users);
  const profiles = await db.select({ userId: schema.profiles.userId, answers: schema.profiles.answers, searchProfileAt: schema.profiles.searchProfileAt }).from(schema.profiles);
  const mats = await db.select({ userId: schema.materials.userId }).from(schema.materials).where(inArray(schema.materials.kind, ["resume", "linkedin"]));
  const ran = await db.selectDistinct({ userId: schema.runs.userId }).from(schema.runs).where(and(eq(schema.runs.status, "done"), inArray(schema.runs.trigger, ["scheduled", "manual"])));
  const acted = await db
    .selectDistinct({ userId: schema.userOpportunities.userId })
    .from(schema.userOpportunities)
    .where(inArray(schema.userOpportunities.stage, ["Applied", "Interview", "Offer", "Not selected", "Ghosted"]));
  const found = await db.selectDistinct({ userId: schema.userOpportunities.userId }).from(schema.userOpportunities);
  const pinned = await db.selectDistinct({ userId: schema.userOpportunities.userId }).from(schema.userOpportunities).where(eq(schema.userOpportunities.pinned, true));
  const set = (xs: { userId: string }[]) => new Set(xs.map((x) => x.userId));
  const [mat, ranS, foundS, actS, pinS] = [set(mats), set(ran), set(found), set(acted), set(pinned)];
  const prof = new Map(profiles.map((p) => [p.userId, p]));
  // Admins and disabled accounts are left out, so testing doesn't count.
  const live = users.filter((u) => !u.disabled && !isAdmin(u));
  const steps = new Map<string, FunnelPerson>(
    live.map((u) => [
      u.id,
      {
        signedIn: !!u.lastLoginAt,
        welcome: !!u.onboardedAt,
        answered: answeredCount(job, (prof.get(u.id)?.answers ?? {}) as Record<string, string | string[]>) >= job.questions.length,
        material: mat.has(u.id),
        searchProfile: !!prof.get(u.id)?.searchProfileAt,
        searched: ranS.has(u.id),
        found: foundS.has(u.id),
        acted: actS.has(u.id) || pinS.has(u.id),
      },
    ]),
  );
  const lastSeen = new Map<string, Date>();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!lastSeen.has(r.userId) || r.at > lastSeen.get(r.userId)!) lastSeen.set(r.userId, r.at);
    counts.set(r.userId, (counts.get(r.userId) ?? 0) + 1);
  }
  return {
    weeks: weeklyActives(rows, 8),
    funnel: funnel([...steps.values()]),
    people: live
      .map((u) => ({ id: u.id, who: u.name || u.email, next: nextStep(steps.get(u.id)!), lastSeen: lastSeen.get(u.id)?.toISOString() ?? null, events: counts.get(u.id) ?? 0 }))
      .sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "")),
  };
}

/** A person's own events, oldest first, for their data export. */
export async function eventsFor(userId: string) {
  return db.select({ type: schema.events.type, target: schema.events.target, at: schema.events.at }).from(schema.events).where(eq(schema.events.userId, userId)).orderBy(asc(schema.events.at));
}

/** One person's last 300 events, heartbeats folded into time on page. */
export async function timelineFor(userId: string) {
  const rows = await db.select({ type: schema.events.type, target: schema.events.target, at: schema.events.at }).from(schema.events).where(eq(schema.events.userId, userId)).orderBy(desc(schema.events.at)).limit(300);
  return timeline(rows).map((r) => ({ ...r, at: r.at.toISOString() }));
}

