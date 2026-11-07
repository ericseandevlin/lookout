import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema, sqlClient } from "@/lib/db";
import { env } from "@/lib/env";
import { answeredCount, kinds } from "@/lib/kinds";
import { BudgetError } from "@/lib/ai/runs";
import { AiConfigError } from "@/lib/ai/llm";
import { SearchConfigError } from "@/lib/ai/search";
import { discover, isRunning } from "@/lib/agent/discover";
import { sendDigest } from "@/lib/digest";
import { getAiConfig } from "@/lib/config";
import { sweepApplications } from "@/lib/application/run";
import { searchOn } from "@/lib/sources";
import { cleanup } from "@/lib/retention";
import { recordError } from "@/lib/errorLog";

const TICK_MS = 10 * 60_000;
const RUN_HOUR = 7; // local time
const LOCK_ID = 7_431_001;
let lastCleanup = 0;
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

function isRunDay(s: { freq: string; runDay: string; runDays: string[] }, day: string) {
  if (s.freq === "Daily") return true;
  if (s.freq === "Twice a week") return s.runDays.includes(day);
  return s.runDay === day;
}

/** Active searches whose setup is complete and that are due: never searched, or today is a run day and today's run hasn't happened (#8). */
async function dueSearches() {
  const now = localNow();
  const rows = await db
    .select({ user: schema.users, settings: schema.settings, search: schema.searches })
    .from(schema.users)
    .innerJoin(schema.settings, eq(schema.settings.userId, schema.users.id))
    .innerJoin(schema.searches, eq(schema.searches.id, schema.settings.activeSearchId))
    .where(eq(schema.users.disabled, false));
  const due: { userId: string; searchId: string }[] = [];
  for (const { user, settings, search } of rows) {
    const cfg = kinds[search.kind] ?? kinds.job;
    // No discovery source for this kind (rfp needs a SAM.gov key, #272): nothing to run.
    if (!searchOn(search.kind)) continue;
    if (answeredCount(cfg, search.answers) < cfg.questions.length) continue;
    const [resume] = await db
      .select({ id: schema.materials.id })
      .from(schema.materials)
      .where(and(eq(schema.materials.userId, user.id), eq(schema.materials.kind, "resume"), eq(schema.materials.status, "done")));
    if (!resume) continue;
    const ever = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.runs)
      .where(and(eq(schema.runs.searchId, search.id), sql`${schema.runs.trigger} in ('scheduled','manual')`, eq(schema.runs.status, "done")));
    // Back off for 2h after a failed search so a broken setup doesn't retry every tick.
    const [{ n: failing }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.runs)
      .where(and(eq(schema.runs.userId, user.id), eq(schema.runs.status, "failed"), gte(schema.runs.startedAt, new Date(Date.now() - 2 * 3600_000))));
    if (failing > 0) continue;
    if (await isRunning(user.id)) continue;
    if (ever[0].n === 0) {
      due.push({ userId: user.id, searchId: search.id });
      continue;
    }
    if (!isRunDay(settings, now.day) || now.hour < RUN_HOUR) continue;
    const since = new Date(Date.now() - 20 * 3600_000);
    const [{ n: recent }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.runs)
      .where(and(eq(schema.runs.searchId, search.id), eq(schema.runs.trigger, "scheduled"), gte(schema.runs.startedAt, since)));
    if (recent === 0) due.push({ userId: user.id, searchId: search.id });
  }
  return due;
}

/** Log a scheduler failure and keep it for Admin > Errors (#12). */
function fail(what: string, e: unknown) {
  console.error(`[scheduler] ${what}`, e);
  void recordError("scheduler", e, { path: what });
}

export async function tick() {
  // Advisory lock so overlapping ticks (or a second instance) never double-run. The lock belongs to
  // one session, so take and release it on one reserved connection, not whichever the pool hands out (#316).
  const conn = await sqlClient.reserve();
  try {
    const [{ locked }] = await conn`select pg_try_advisory_lock(${LOCK_ID}) as locked`;
    if (!locked) return;
    try {
      await work();
    } finally {
      await conn`select pg_advisory_unlock(${LOCK_ID})`;
    }
  } finally {
    conn.release();
  }
}

/** One scheduler pass: retention, stuck runs, auto-apply sweep, then due searches. */
async function work() {
  // Retention (#26) once a day, before the model check so it runs even with no model set.
  if (Date.now() - lastCleanup > 24 * 3600_000) {
    lastCleanup = Date.now();
    await cleanup()
      .then((n) => console.log(`[scheduler] cleanup: ${n.loginTokens} sign-in links, ${n.sessions} sessions, ${n.runLogs} run logs, ${n.errors} errors`))
      .catch((e) => fail("cleanup", e));
  }
  const ai = await getAiConfig();
  if (ai.provider !== "agent" && !ai.model) return; // Nothing to run with until an admin sets a model.
  // Runs orphaned by a restart never finish; close them out.
  await db
    .update(schema.runs)
    .set({ status: "failed", error: "Interrupted", finishedAt: new Date() })
    .where(and(eq(schema.runs.status, "running"), lt(schema.runs.startedAt, new Date(Date.now() - 45 * 60_000))));
  await db
    .update(schema.runs)
    .set({ status: "failed", error: "The search agent never picked this up", finishedAt: new Date() })
    .where(and(eq(schema.runs.status, "queued"), lt(schema.runs.startedAt, new Date(Date.now() - 24 * 3600_000))));
  // Auto-apply work left queued or interrupted (normally it starts the moment it's queued).
  await sweepApplications().catch((e) => fail("apply sweep", e));
  for (const { userId, searchId } of await dueSearches()) {
    try {
      const r = await discover(searchId, "scheduled");
      // Even with nothing new: pinned finds due soon still go out, once a day (#304).
      await sendDigest(userId, "runId" in r ? r.runId : undefined);
    } catch (e) {
      // Caps and missing config affect everyone; stop this tick instead of failing search by search.
      if (e instanceof BudgetError || e instanceof AiConfigError || e instanceof SearchConfigError) break;
      fail(`run failed for search ${searchId}`, e);
    }
  }
}

let started = false;
export function startScheduler() {
  if (started || !env.schedulerEnabled) return;
  started = true;
  const safeTick = () => tick().catch((e) => fail("tick", e));
  setTimeout(safeTick, 30_000);
  setInterval(safeTick, TICK_MS);
  console.log(`[scheduler] on, every ${TICK_MS / 60_000} min, tz ${env.timezone}`);
}

export { DAY_KEYS };
