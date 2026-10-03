import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { hashToken, newToken } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { isAdmin, normalizeEmail } from "@/lib/users";

const Input = z.object({ email: z.string().trim().email().max(254) });
const INVITE_DAYS = 7;

/**
 * Admin-only: mint a one-time sign-in link to hand to someone directly (text, DM).
 * Works without SMTP. Using the link creates the account, even in invite-only mode.
 */
export const POST = authed(async (req, { user }) => {
  if (!isAdmin(user)) throw new HttpError(403, "Admins only");
  const email = normalizeEmail((await body(req, Input)).email);
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5);
  await db.insert(schema.loginTokens).values({ tokenHash: hashToken(token), email, expiresAt });
  return json({ link: `${env.appUrl}/auth/verify?token=${token}`, email, expiresAt: expiresAt.toISOString() });
});
