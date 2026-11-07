import { z } from "zod";
import { track } from "@/lib/eventStore";
import { authed, body, HttpError, json } from "@/lib/api";
import { BudgetError } from "@/lib/ai/runs";
import { addByUrl, isRunning } from "@/lib/agent/discover";
import { kindOf } from "@/lib/kinds";
import { rateLimit } from "@/lib/ratelimit";
import { getAiConfig } from "@/lib/config";
import { getActiveSearch } from "@/lib/searches";

const Input = z.object({ url: z.string().trim().url().max(1000).refine((u) => /^https?:\/\//i.test(u), "Use an http(s) link") });

/** Manual add, to the active search's board (#8). Runs in the background; the client polls /api/state until `running` clears. */
export const POST = authed(async (req, { user }) => {
  const { url } = await body(req, Input);
  if (!await rateLimit(`add-url:${user.id}`, 20, 24 * 3600_000)) throw new HttpError(429, "That's enough links for today.");
  const search = await getActiveSearch(user.id);
  if (!search) throw new HttpError(409, "Create a search first.");
  // A kind without sources yet (rfp until SAM.gov lands, #8) can't be searched.
  if (!kindOf(search.kind).discovery) throw new HttpError(400, "Adding finds by link isn't on for this kind yet.");
  const ai = await getAiConfig();
  if (ai.provider !== "agent" && !ai.model) throw new HttpError(503, "Adding links isn't set up yet: no AI model is configured.");
  if (await isRunning(user.id)) throw new HttpError(409, "Lookout is already working. Try again in a minute.");
  await track(user.id, "find_added");
  void addByUrl(search.id, url).catch((e) => {
    if (!(e instanceof BudgetError)) console.error("addByUrl", e);
  });
  return json({ ok: true }, { status: 202 });
});
