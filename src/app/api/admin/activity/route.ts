import { z } from "zod";
import { adminRoute, HttpError, json } from "@/lib/api";
import { activity, timelineFor } from "@/lib/eventStore";

/** Admin > Activity (#35). ?user=<id> returns that person's timeline. */
export const GET = adminRoute(async (req) => {
  const u = new URL(req.url).searchParams.get("user");
  if (u === null) return json(await activity());
  if (!z.string().uuid().safeParse(u).success) throw new HttpError(404, "Not found");
  return json({ timeline: await timelineFor(u) });
});
