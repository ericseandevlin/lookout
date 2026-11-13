import { HttpError, json } from "@/lib/api";
import { agentRoute } from "@/lib/agentAuth";
import { badResultsSince } from "@/lib/ai/badResults";

export const dynamic = "force-dynamic";

/**
 * GET ?since=<ISO time>&limit=50 -> the bad results for the weekly AI review (#994): failed runs, failed applications
 * and "Not a fit" finds, each with the trace id to open in PostHog. `since` defaults to 7 days ago.
 * Same staging-only token as /api/agent/errors; without it this route is a 404.
 */
export const GET = agentRoute(async (req) => {
  const url = new URL(req.url);
  const s = url.searchParams.get("since");
  const since = s ? new Date(s) : new Date(Date.now() - 7 * 864e5);
  if (Number.isNaN(since.getTime())) throw new HttpError(400, "since must be an ISO time");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  return json(await badResultsSince(since, limit));
}, "AGENT_ERRORS_TOKEN");
