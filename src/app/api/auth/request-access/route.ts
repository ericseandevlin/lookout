import { z } from "zod";
import { body, clientIp, HttpError, json, publicRoute } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { NEXT_MOVES } from "@/lib/onboarding";
import { rateLimit } from "@/lib/ratelimit";
import { normalizeEmail } from "@/lib/users";

const Input = z.object({
  email: z.string().trim().email().max(254),
  nextMove: z.enum(NEXT_MOVES.map((m) => m.key) as [string, ...string[]]).optional(),
});

/** Invite-only waitlist. Same response whether the email is new, pending, or already in. */
export const POST = publicRoute(async (req) => {
  if (!await rateLimit(`request-ip:${await clientIp()}`, 5, 60 * 60_000)) throw new HttpError(429, "Too many requests. Try again in an hour.");
  const p = await body(req, Input);
  const email = normalizeEmail(p.email);
  await db
    .insert(schema.accessRequests)
    .values({ email, nextMove: p.nextMove ?? null })
    // A repeat request refreshes the answer but never reopens a decision.
    .onConflictDoUpdate({ target: schema.accessRequests.email, set: { nextMove: p.nextMove ?? null } });
  return json({ ok: true });
});
