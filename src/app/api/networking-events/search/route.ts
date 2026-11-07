import { featureOn } from "@/lib/features";
import { authed, HttpError, json } from "@/lib/api";
import { assertBudget, BudgetError } from "@/lib/ai/runs";
import { eventSearchRunning, getEventPrefs, searchEventsNow } from "@/lib/agent/networking";
import { getAiConfig } from "@/lib/config";
import { rateLimit } from "@/lib/ratelimit";

/** Events "Search now" (#265). Starts an event search on its own and returns; the page polls GET for `searching`. */
export const POST = authed(async (_req, { user }) => {
  if (!featureOn("EVENTS")) throw new HttpError(404, "Not found");
  if (!(await getEventPrefs(user.id)).interests) throw new HttpError(409, "Pick an interest first, so Lookout knows what to look for.");
  if (await eventSearchRunning(user.id)) throw new HttpError(409, "An event search is already running.");
  try {
    await assertBudget(user.id);
  } catch (e) {
    if (e instanceof BudgetError) throw new HttpError(429, e.message);
    throw e;
  }
  const ai = await getAiConfig();
  if (ai.provider === "agent" || !ai.model) throw new HttpError(503, "Event search needs an AI model. An admin can set one under Admin > AI settings.");
  if (!(await rateLimit(`events-now:${user.id}`, 3, 24 * 3600_000))) throw new HttpError(429, "You can search for events on demand 3 times a day.");
  void searchEventsNow(user.id).catch((e) => console.error("[events] search now", e));
  return json({ started: true }, { status: 202 });
});
