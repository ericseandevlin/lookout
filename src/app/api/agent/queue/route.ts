import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { json } from "@/lib/api";
import { agentRoute } from "@/lib/agentAuth";
import { db, schema } from "@/lib/db";
import { loadContext } from "@/lib/agent/discover";
import { progress } from "@/lib/ai/runs";

export const dynamic = "force-dynamic";

/**
 * GET ?peek=1 -> { queued: n } without claiming (cheap, for the poller).
 * GET          -> claims up to 3 queued jobs and returns everything needed to do them.
 */
export const GET = agentRoute(async (req) => {
  const url = new URL(req.url);
  // Heartbeat so the admin page can show whether the agent is alive.
  await db
    .insert(schema.appSettings)
    .values({ key: "agent_seen", value: { at: new Date().toISOString() } })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: { at: new Date().toISOString() }, updatedAt: new Date() } });
  if (url.searchParams.get("peek")) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.runs).where(eq(schema.runs.status, "queued"));
    return json({ queued: n });
  }
  // Claim atomically so two agents never take the same job.
  const claimed = await db
    .update(schema.runs)
    .set({ status: "running", startedAt: new Date() })
    .where(
      inArray(
        schema.runs.id,
        db.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.status, "queued")).orderBy(asc(schema.runs.startedAt)).limit(3),
      ),
    )
    .returning();
  const jobs = [];
  for (const run of claimed) {
    await progress(run.id, 2, "The search agent picked this up");
    const ctx = await loadContext(run.userId);
    const req = (run.request ?? {}) as { type?: string; url?: string; materialId?: string };
    let resumeText: string | undefined;
    if (req.type === "resume" && req.materialId) {
      const [m] = await db
        .select()
        .from(schema.materials)
        .where(and(eq(schema.materials.id, req.materialId), eq(schema.materials.userId, run.userId)));
      resumeText = m?.extracted?.text?.slice(0, 40_000);
    }
    jobs.push({
      runId: run.id,
      type: req.type ?? "discover",
      url: req.url,
      profile: { brief: ctx.brief, resume: ctx.resume, linkedin: ctx.linkedin, links: ctx.links, compFloor: ctx.floor },
      skipUrls: ctx.knownUrls.slice(-200),
      resumeText,
    });
  }
  return json({ jobs });
});
