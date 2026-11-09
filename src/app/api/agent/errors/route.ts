import { HttpError, json } from "@/lib/api";
import { agentRoute } from "@/lib/agentAuth";
import { listErrorsSince } from "@/lib/errorLog";

export const dynamic = "force-dynamic";

/**
 * GET ?since=<ISO time>&limit=50 -> server errors for agents to file as issues (#486).
 * Needs AGENT_ERRORS_TOKEN, a token of its own that only staging sets; without it this route is a 404.
 */
export const GET = agentRoute(async (req) => {
  const url = new URL(req.url);
  const s = url.searchParams.get("since");
  const since = s ? new Date(s) : null;
  if (since && Number.isNaN(since.getTime())) throw new HttpError(400, "since must be an ISO time");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  return json({ errors: await listErrorsSince(since, limit) });
}, "AGENT_ERRORS_TOKEN");
