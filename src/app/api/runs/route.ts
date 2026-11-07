import { authed, HttpError, json } from "@/lib/api";
import { track } from "@/lib/eventStore";
import { assertBudget, BudgetError } from "@/lib/ai/runs";
import { discover, isRunning } from "@/lib/agent/discover";
import { rateLimit } from "@/lib/ratelimit";
import { getAiConfig } from "@/lib/config";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { answeredCount, kinds } from "@/lib/kinds";
import { searchBlocker } from "@/lib/ready";

/** The same readiness rule the board shows, checked here too so a stale tab can't start an empty search (#255). */
async function blocker(userId: string) {
  const [profile] = await db.select({ kind: schema.profiles.kind, answers: schema.profiles.answers }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const resumes = await db
    .select({ status: schema.materials.status })
    .from(schema.materials)
    .where(and(eq(schema.materials.userId, userId), eq(schema.materials.kind, "resume")));
  const answered = profile ? answeredCount(kinds[profile.kind] ?? kinds.job, profile.answers) : 0;
  return { blocker: searchBlocker(answered, resumes.some((r) => r.status === "done") ? "done" : resumes[0]?.status), cfg: kinds[profile?.kind ?? "job"] ?? kinds.job };
}

/** "Search now". Limited to a few a day per user on top of the spend caps. */
export const POST = authed(async (_req, { user }) => {
  if (await isRunning(user.id)) throw new HttpError(409, "A search is already running.");
  const missing = await blocker(user.id);
  if (missing.blocker) throw new HttpError(409, `${missing.blocker.text}.`);
  // A kind without sources yet (rfp until SAM.gov lands, #8) can't be searched.
  if (!missing.cfg.discovery) throw new HttpError(400, "Searching for this isn't on yet. Lookout will tell you when it is.");
  try {
    await assertBudget(user.id);
  } catch (e) {
    if (e instanceof BudgetError) throw new HttpError(429, e.message);
    throw e;
  }
  const ai = await getAiConfig();
  if (ai.provider !== "agent" && !ai.model) throw new HttpError(503, "Search isn't set up yet: no AI model is configured. An admin can set one under Admin > AI settings.");
  if (!await rateLimit(`run-now:${user.id}`, 3, 24 * 3600_000)) throw new HttpError(429, "You can search on demand 3 times a day.");
  await track(user.id, "search_run", "manual");
  void discover(user.id, "manual").catch((e) => console.error("discover", e));
  return json({ ok: true }, { status: 202 });
});
