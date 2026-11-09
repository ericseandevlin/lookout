import { and, eq, gt, isNull } from "drizzle-orm";
import { track } from "@/lib/eventStore";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { body, clientIp, HttpError, json, publicRoute } from "@/lib/api";
import { hashToken } from "@/lib/auth/crypto";
import { createSession } from "@/lib/auth/session";
import { acceptedNow, needsConsent } from "@/lib/legal";
import { rateLimit } from "@/lib/ratelimit";
import { ensureUser, findUserByEmail, touchLogin } from "@/lib/users";

const Input = z.object({ token: z.string().min(20).max(100), agree: z.literal(true).optional() });

// POST, not GET: mail scanners prefetch GET links and would burn the token.
export const POST = publicRoute(async (req) => {
  if (!await rateLimit(`verify-ip:${await clientIp()}`, 30, 60 * 60_000)) throw new HttpError(429, "Too many attempts");
  const { token, agree } = await body(req, Input);
  const [row] = await db
    .update(schema.loginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.loginTokens.tokenHash, hashToken(token)),
        // Email-change tokens share this table; they only work at confirm-email (#208).
        eq(schema.loginTokens.purpose, "login"),
        isNull(schema.loginTokens.usedAt),
        gt(schema.loginTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) throw new HttpError(400, "This link has expired or was already used.");
  // A valid token is proof the email was let in (sign-up request passed mayLogIn, or an admin invited it).
  // Still refuse disabled accounts.
  if ((await findUserByEmail(row.email))?.disabled) throw new HttpError(403, "This email can't sign in.");
  const user = await ensureUser(row.email);
  await touchLogin(user.id);
  await createSession(user.id);
  await track(user.id, "sign_in");
  // The sign-in screen doubles as the terms screen for onboarded accounts (#525). New accounts agree on welcome.
  if (agree && user.onboardedAt && needsConsent(user)) {
    await db.update(schema.users).set(acceptedNow()).where(eq(schema.users.id, user.id));
    await track(user.id, "consent_accepted");
  }
  return json({ ok: true });
});
