import "server-only";
import { desc, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isAdmin } from "@/lib/users";

/**
 * The onboarding funnel (#35), in order. Each step is the first time it happened, read from the tables
 * that already record it, so it covers people who joined before events existed.
 */
export const STEPS = [
  { key: "joined", label: "Account created" },
  { key: "welcome", label: "Welcome step done" },
  { key: "profile", label: "Profile saved" },
  { key: "material", label: "Resume or link added" },
  { key: "searchProfile", label: "Search profile built" },
  { key: "search", label: "First search" },
  { key: "find", label: "First find" },
  { key: "opened", label: "Opened a find" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

export type FunnelPerson = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  steps: Record<StepKey, string | null>;
  /** The first step not reached yet; null once every step is done. */
  stuckAt: StepKey | null;
  lastSeenAt: string | null;
};

export const stuckAt = (steps: Record<StepKey, string | null>): StepKey | null =>
  STEPS.find((s) => !steps[s.key])?.key ?? null;

/** People who reached each step. Admins and disabled accounts are left out, so testing doesn't count. */
export const summarize = (people: FunnelPerson[]) => {
  const counted = people.filter((p) => !p.isAdmin);
  return STEPS.map((s) => ({ ...s, reached: counted.filter((p) => p.steps[s.key]).length }));
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function funnel() {
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      isAdminFlag: schema.users.isAdmin,
      disabled: schema.users.disabled,
      joined: schema.users.createdAt,
      welcome: schema.users.onboardedAt,
      profile: sql`(select p.saved_at from ${schema.profiles} p where p.user_id = "users"."id")`,
      material: sql`(select min(m.created_at) from ${schema.materials} m where m.user_id = "users"."id")`,
      searchProfile: sql`(select p.search_profile_at from ${schema.profiles} p where p.user_id = "users"."id")`,
      search: sql`(select min(r.started_at) from ${schema.runs} r where r.user_id = "users"."id" and r.trigger in ('scheduled', 'manual'))`,
      find: sql`(select min(uo.added_at) from ${schema.userOpportunities} uo where uo.user_id = "users"."id")`,
      opened: sql`(select min(uo.seen_at) from ${schema.userOpportunities} uo where uo.user_id = "users"."id")`,
      lastSeenAt: sql`(select max(s.last_seen_at) from ${schema.sessions} s where s.user_id = "users"."id")`,
    })
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt));

  const people: FunnelPerson[] = rows
    .filter((r) => !r.disabled)
    .map((r) => {
      const steps = Object.fromEntries(STEPS.map((s) => [s.key, iso(r[s.key])])) as Record<StepKey, string | null>;
      return {
        id: r.id,
        email: r.email,
        name: r.name,
        isAdmin: isAdmin({ isAdmin: r.isAdminFlag, email: r.email }),
        steps,
        stuckAt: stuckAt(steps),
        lastSeenAt: iso(r.lastSeenAt),
      };
    });
  return { steps: summarize(people), people };
}
