import { z } from "zod";
import { body, clientIp, HttpError, json, publicRoute } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { kinds } from "@/lib/kinds";
import { NEXT_MOVES } from "@/lib/onboarding";
import { rateLimit } from "@/lib/ratelimit";
import { turnstileSiteKey, verifyTurnstile } from "@/lib/turnstile";
import { normalizeEmail } from "@/lib/users";

const Input = z.object({
  email: z.string().trim().email().max(254),
  /** What they want Lookout to find (#8); picks the kind of profile they get at sign-up. */
  kind: z.enum(Object.keys(kinds) as [string, ...string[]]).optional(),
  nextMove: z.enum(NEXT_MOVES.map((m) => m.key) as [string, ...string[]]).optional(),
  /** Cloudflare Turnstile token (#13); checked only when Turnstile is configured. */
  turnstileToken: z.string().max(2048).optional(),
});

/** Invite-only waitlist. Same response whether the email is new, pending, or already in. */
export const POST = publicRoute(async (req) => {
  const ip = await clientIp();
  if (!await rateLimit(`request-ip:${ip}`, 5, 60 * 60_000)) throw new HttpError(429, "Too many requests. Try again in an hour.");
  const p = await body(req, Input);
  if (turnstileSiteKey() && !(await verifyTurnstile(p.turnstileToken, ip))) throw new HttpError(400, "We couldn't confirm you're a person. Try again.");
  const email = normalizeEmail(p.email);
  await db
    .insert(schema.accessRequests)
    .values({ email, kind: p.kind ?? "job", nextMove: p.nextMove ?? null })
    // A repeat request refreshes the answers but never reopens a decision.
    .onConflictDoUpdate({ target: schema.accessRequests.email, set: { kind: p.kind ?? "job", nextMove: p.nextMove ?? null } });
  return json({ ok: true });
});
