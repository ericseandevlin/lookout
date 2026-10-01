import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema, sqlClient } from "@/lib/db";
import { env } from "@/lib/env";
import { answeredCount, kinds } from "@/lib/kinds";
import { BudgetError } from "@/lib/agent/claude";
import { discover } from "@/lib/agent/discover";
import { sendDigest } from "@/lib/digest";

const TICK_MS = 10 * 60_000;
const RUN_HOUR = 7; // local time
const LOCK_ID = 7_431_001;
const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: env.timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: get("weekday"), hour: Number(get("hour")) % 24, date: `${get("year")}-${get("month")}-${get("day")}` };
}

export function isRunDay(s: { freq: string; runDay: string; runDays: string[] }, day: string) {
  if (s.freq === "Daily") return true;
  if (s.freq === "Twice a week") return s.runDays.includes(day);
  return s.runDay === day;
}

/** Users whose setup is complete and who are due: never searched, or today is a run day and today's run hasn't happened. */
async function dueUsers() {
  const now = localNow();
  const rows = await db
    .select({ user: schema.users, settings: schema.settings, profile: schema.profiles })
    .from(schema.users)
    .innerJoin(schema.settings, eq(schema.settings.userId, schema.users.id))
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(eq(schema.users.disabled, false));
  const due: string[] = [];
  for (const { user, settings, profile } of rows) {
    if (answeredCount(kinds[profile.kind] ?? kinds.job, profile.answers) < 5) continue;
    const [resume] = await db
      .select({ id: schema.materials.id })
      .from(schema.materials)
      .where(and(eq(schema.materials.userId, user.id), eq(schema.materials.kind, "resume"), eq(schema.materials.status, "done")));
    if (!resume) continue;
    const runs = db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.runs)
      .where(and(eq(schema.runs.userId, user.id), sql`${schema.runs.trigger} in ('scheduled','manual')`));
    const [{ n: ever }] = await runs;
    if (ever === 0) {
      due.push(user.id);
      continue;
    }
    if (!isRunDay(settings, now.day) || now.hour < RUN_HOUR) continue;
    const since = new Date(Date.now() - 20 * 3600_000);
    const [{ n: recent }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.runs)
      .where(and(eq(schema.runs.userId, user.id), eq(schema.runs.trigger, "scheduled"), gte(schema.runs.startedAt, since)));
    if (recent === 0) due.push(user.id);
  }
  return due;
}

async function tick() {
  // Advisory lock so overlapping ticks (or a second instance) never double-run.
  const [{ locked }] = await sqlClient`select pg_try_advisory_lock(${LOCK_ID}) as locked`;
  if (!locked) return;
  try {
    // Runs orphaned by a restart never finish; close them out.
    await db
      .update(schema.runs)
      .set({ status: "failed", error: "Interrupted", finishedAt: new Date() })
      .where(and(eq(schema.runs.status, "running"), lt(schema.runs.startedAt, new Date(Date.now() - 45 * 60_000))));
    for (const userId of await dueUsers()) {
      try {
        const { added } = await discover(userId, "scheduled");
        if (added > 0) await sendDigest(userId);
      } catch (e) {
        if (e instanceof BudgetError) break;
        console.error(`[scheduler] run failed for ${userId}`, e);
      }
    }
  } finally {
    await sqlClient`select pg_advisory_unlock(${LOCK_ID})`;
  }
}

let started = false;
export function startScheduler() {
  if (started || !env.schedulerEnabled) return;
  started = true;
  const safeTick = () => tick().catch((e) => console.error("[scheduler]", e));
  setTimeout(safeTick, 30_000);
  setInterval(safeTick, TICK_MS);
  console.log(`[scheduler] on, every ${TICK_MS / 60_000} min, tz ${env.timezone}`);
}

export { DAY_KEYS };
