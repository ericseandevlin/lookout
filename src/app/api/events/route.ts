import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { CLIENT_EVENTS } from "@/lib/events";
import { track } from "@/lib/eventStore";
import { rateLimit } from "@/lib/ratelimit";

const Input = z.object({ type: z.enum(CLIENT_EVENTS), target: z.string().max(300).nullable().optional() });

/** The few events only the browser sees (#35): page views, time on page, opening a find or posting, the report, tips. */
export const POST = authed(async (req, { user }) => {
  const e = await body(req, Input);
  if (await rateLimit(`events:${user.id}`, 600, 3600_000)) await track(user.id, e.type, e.target ?? null);
  return json({ ok: true });
});
