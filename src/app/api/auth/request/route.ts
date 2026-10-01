import { z } from "zod";
import { db, schema } from "@/lib/db";
import { body, clientIp, HttpError, json, publicRoute } from "@/lib/api";
import { hashToken, newToken } from "@/lib/auth/crypto";
import { magicLinkEmail, sendMail } from "@/lib/email";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/ratelimit";
import { mayLogIn, normalizeEmail } from "@/lib/users";

const Input = z.object({ email: z.string().trim().email().max(254) });

export const POST = publicRoute(async (req) => {
  const { email: raw } = await body(req, Input);
  const email = normalizeEmail(raw);
  const ip = await clientIp();
  if (!rateLimit(`login-ip:${ip}`, 10, 60 * 60_000) || !rateLimit(`login-email:${email}`, 5, 60 * 60_000)) {
    throw new HttpError(429, "Too many requests. Try again in an hour.");
  }
  // Same response whether or not the address may sign in, so the endpoint can't be used to probe accounts.
  if (await mayLogIn(email)) {
    const token = newToken();
    await db.insert(schema.loginTokens).values({
      tokenHash: hashToken(token),
      email,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    await sendMail(magicLinkEmail(email, `${env.appUrl}/auth/verify?token=${token}`));
  }
  return json({ ok: true });
});
