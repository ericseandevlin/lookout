import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { BudgetError } from "@/lib/agent/claude";
import { addByUrl, isRunning } from "@/lib/agent/discover";
import { rateLimit } from "@/lib/ratelimit";

const Input = z.object({ url: z.string().trim().url().max(1000).refine((u) => /^https?:\/\//i.test(u), "Use an http(s) link") });

/** Manual add. Runs in the background; the client polls /api/state until `running` clears. */
export const POST = authed(async (req, { user }) => {
  const { url } = await body(req, Input);
  if (!rateLimit(`add-url:${user.id}`, 20, 24 * 3600_000)) throw new HttpError(429, "That's enough links for today.");
  if (await isRunning(user.id)) throw new HttpError(409, "Lookout is already working. Try again in a minute.");
  void addByUrl(user.id, url).catch((e) => {
    if (!(e instanceof BudgetError)) console.error("addByUrl", e);
  });
  return json({ ok: true }, { status: 202 });
});
