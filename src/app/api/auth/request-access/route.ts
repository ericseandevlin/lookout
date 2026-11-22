import { featureOn } from "@/lib/features";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { body, clientIp, HttpError, json, publicRoute } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { kinds } from "@/lib/kinds";
import { secrets } from "@/lib/bulkMail";
import { sendMail } from "@/lib/email";
import { env } from "@/lib/env";
import { WAITLIST_NOTICE_VERSION, WAITLIST_OPTIN_NOTICE_VERSION } from "@/lib/legal";
import { confirmEmail, confirmToken } from "@/lib/waitlist";
import { channelOf } from "@/lib/metrics";
import { NEXT_MOVES } from "@/lib/onboarding";
import { rateLimit } from "@/lib/ratelimit";
import { referrerOf } from "@/lib/referral";
import { turnstileSiteKey, verifyTurnstile } from "@/lib/turnstile";
import { normalizeEmail } from "@/lib/users";

const Input = z.object({
  email: z.string().trim().email().max(254),
  /** What they want Lookout to find (#8); picks the kind of profile they get at sign-up. */
  kind: z.enum(Object.keys(kinds) as [string, ...string[]]).optional(),
  nextMove: z.enum(NEXT_MOVES.map((m) => m.key) as [string, ...string[]]).optional(),
  /** Where they came from (#527): the landing link's ?ref= or ?utm_source=. */
  channel: z.string().max(200).optional(),
  /** Cloudflare Turnstile token (#13); checked only when Turnstile is configured. */
  turnstileToken: z.string().max(2048).optional(),
  /** In their own words, what they'd want it to search for (#9). Kept only when FEATURE_WAITLIST is on. */
  searchFor: z.string().max(500).optional(),
});

/**
 * Invite-only waitlist. Same response whether the email is new, pending, or already in.
 * With FEATURE_WAITLIST on (#9), a pending, unconfirmed request also gets one confirm email (double opt-in).
 */
export const POST = publicRoute(async (req) => {
  const ip = await clientIp();
  if (!await rateLimit(`request-ip:${ip}`, 5, 60 * 60_000)) throw new HttpError(429, "Too many requests. Try again in an hour.");
  const p = await body(req, Input);
  if (turnstileSiteKey() && !(await verifyTurnstile(p.turnstileToken, ip))) throw new HttpError(400, "We couldn't confirm you're a person. Try again.");
  const email = normalizeEmail(p.email);
  const optIn = featureOn("WAITLIST");
  // The consent record (#28): which email notice the form showed, and when they sent it.
  const answers = {
    kind: featureOn("SEARCHES") ? p.kind ?? "job" : "job",
    nextMove: p.nextMove ?? null,
    consentVersion: optIn ? WAITLIST_OPTIN_NOTICE_VERSION : WAITLIST_NOTICE_VERSION,
    consentAt: new Date(),
    ...(optIn && { searchFor: p.searchFor?.trim() || null }),
  };
  // Someone's personal link (#527) counts under one "referral" channel and records who sent them.
  const channel = channelOf(p.channel);
  const referredBy = await referrerOf(channel);
  const [row] = await db
    .insert(schema.accessRequests)
    .values({ email, ...answers, channel: referredBy ? "referral" : channel, referredBy })
    // A repeat request refreshes the answers but never reopens a decision, and keeps the channel they first came from.
    .onConflictDoUpdate({
      target: schema.accessRequests.email,
      set: {
        ...answers,
        channel: sql`coalesce(${schema.accessRequests.channel}, excluded.channel)`,
        referredBy: sql`case when ${schema.accessRequests.channel} is null then excluded.referred_by else ${schema.accessRequests.referredBy} end`,
      },
    })
    .returning({ status: schema.accessRequests.status, confirmedAt: schema.accessRequests.confirmedAt });
  if (!optIn) return json({ ok: true });
  // At most 3 confirm emails a day to one address, so the form can't be used to flood someone's inbox.
  if (row.status === "pending" && !row.confirmedAt && (await rateLimit(`waitlist-confirm:${email}`, 3, 24 * 60 * 60_000))) {
    await sendMail(confirmEmail(email, `${env.appUrl}/waitlist/confirm?t=${confirmToken(secrets()[0], email)}`));
  }
  return json({ ok: true, confirm: true });
});
