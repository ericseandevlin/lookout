import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { hashToken, newToken } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import { emailChangeEmail, sendMail } from "@/lib/email";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/ratelimit";
import { findUserByEmail, normalizeEmail } from "@/lib/users";

const Input = z.object({ email: z.string().trim().email().max(254) });

/** Start an email change: a confirmation link goes to the new address; nothing changes until it's clicked. */
export const POST = authed(async (req, { user }) => {
  if (!env.smtpUrl && !env.logEmails) throw new HttpError(503, "Email isn't set up yet, so a new address can't be confirmed.");
  if (!await rateLimit(`email-change:${user.id}`, 5, 60 * 60_000)) throw new HttpError(429, "Too many requests. Try again in an hour.");
  const email = normalizeEmail((await body(req, Input)).email);
  if (email === normalizeEmail(user.email)) throw new HttpError(400, "That's already your email.");
  if (await findUserByEmail(email)) throw new HttpError(409, "That email belongs to another account.");
  const token = newToken();
  await db.insert(schema.loginTokens).values({
    tokenHash: hashToken(token),
    email,
    purpose: "email_change",
    userId: user.id,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  await sendMail(emailChangeEmail(email, `${env.appUrl}/auth/confirm-email?token=${token}`));
  return json({ ok: true });
});
