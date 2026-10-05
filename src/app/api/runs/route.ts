import { authed, HttpError, json } from "@/lib/api";
import { assertBudget, BudgetError } from "@/lib/ai/runs";
import { discover, isRunning } from "@/lib/agent/discover";
import { rateLimit } from "@/lib/ratelimit";
import { getAiConfig } from "@/lib/config";

/** "Search now". Limited to a few a day per user on top of the spend caps. */
export const POST = authed(async (_req, { user }) => {
  if (await isRunning(user.id)) throw new HttpError(409, "A search is already running.");
  try {
    await assertBudget(user.id);
  } catch (e) {
    if (e instanceof BudgetError) throw new HttpError(429, e.message);
    throw e;
  }
  const ai = await getAiConfig();
  if (ai.provider !== "agent" && !ai.model) throw new HttpError(503, "Search isn't set up yet: no AI model is configured. An admin can set one under Admin > AI settings.");
  if (!rateLimit(`run-now:${user.id}`, 3, 24 * 3600_000)) throw new HttpError(429, "You can search on demand 3 times a day.");
  void discover(user.id, "manual").catch((e) => console.error("discover", e));
  return json({ ok: true }, { status: 202 });
});
