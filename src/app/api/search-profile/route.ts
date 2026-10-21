import { authed, HttpError, json } from "@/lib/api";
import { canBuild, ensureSearchProfile } from "@/lib/agent/searchProfile";
import { emptyUsage } from "@/lib/ai/llm";
import { rateLimit } from "@/lib/ratelimit";

/** Profile > What Lookout sees. Opening it rebuilds the profile if the user's inputs changed. */
async function respond(userId: string, force: boolean) {
  const usage = emptyUsage();
  // Building costs a model call; cap rebuilds so a stuck tab can't loop.
  const mayBuild = await rateLimit(`search-profile:${userId}`, 30, 24 * 3600_000);
  const r = await ensureSearchProfile(userId, usage, { force, build: mayBuild });
  const stale = !!r.raw.stored?.searchProfileHash && r.raw.stored.searchProfileHash !== r.raw.hash && !r.rebuilt;
  return json({
    profile: r.profile,
    builtAt: r.rebuilt ? new Date().toISOString() : (r.raw.stored?.searchProfileAt?.toISOString() ?? null),
    sources: r.raw.sources,
    stale,
    canBuild: await canBuild(),
    error: "error" in r ? r.error : null,
  });
}

export const GET = authed(async (_req, { user }) => respond(user.id, false));

export const POST = authed(async (_req, { user }) => {
  if (!(await canBuild())) throw new HttpError(503, "The AI isn't set up yet, so the profile can't be rebuilt.");
  return respond(user.id, true);
});
