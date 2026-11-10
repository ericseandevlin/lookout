import { z } from "zod";
import { db, schema } from "@/lib/db";
import { body, clientIp, HttpError, json, publicRoute } from "@/lib/api";
import { hashToken, newToken } from "@/lib/auth/crypto";
import { magicLinkEmail, sendMail } from "@/lib/email";
import { env } from "@/lib/env";
import { CODE_RE, redeemGroupInvite } from "@/lib/groupInvite";
import { rateLimit } from "@/lib/ratelimit";
import { normalizeEmail } from "@/lib/users";

const Input = z.object({ code: z.string().regex(CODE_RE), email: z.string().trim().email().max(254) });
const SAY = {
  unknown: "This invite link doesn't work. Check the link, or request access instead.",
  closed: "This invite link is closed. Request access instead.",
  expired: "This invite link has expired. Request access instead.",
  full: "Every spot on this invite is taken. Request access instead.",
} as const;

/** POST /api/auth/join (#601): a group invite link. Takes a seat for the email, then emails a sign-in link that creates the account. */
export const POST = publicRoute(async (req) => {
  const { code, email: raw } = await body(req, Input);
  const email = normalizeEmail(raw);
  const ip = await clientIp();
  if (!await rateLimit(`join-ip:${ip}`, 10, 60 * 60_000) || !await rateLimit(`login-email:${email}`, 5, 60 * 60_000)) {
    throw new HttpError(429, "Too many requests. Try again in an hour.");
  }
  const r = await redeemGroupInvite(code, email);
  if (!r.ok) throw new HttpError(r.why === "unknown" ? 404 : 410, SAY[r.why]);
  const token = newToken();
  await db.insert(schema.loginTokens).values({ tokenHash: hashToken(token), email, expiresAt: new Date(Date.now() + 15 * 60_000) });
  await sendMail(magicLinkEmail(email, `${env.appUrl}/auth/verify?token=${token}`));
  return json({ ok: true });
});
