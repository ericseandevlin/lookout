import { z } from "zod";
import { adminRoute, body, json } from "@/lib/api";
import { hashToken, newToken } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import { inviteEmail, sendMail } from "@/lib/email";
import { env } from "@/lib/env";
import { normalizeEmail } from "@/lib/users";

const Input = z.object({ email: z.string().trim().email().max(254), send: z.boolean().optional() });
const INVITE_DAYS = 7;

/**
 * Invite someone: records the invite (so they can request sign-in links later in
 * invite-only mode) and returns a one-time 7-day link to share directly. With
 * `send` and SMTP configured, the link is also emailed.
 */
export const POST = adminRoute(async (req, { user }) => {
  const p = await body(req, Input);
  const email = normalizeEmail(p.email);
  await db
    .insert(schema.invites)
    .values({ email, invitedBy: user.id })
    .onConflictDoUpdate({ target: schema.invites.email, set: { revokedAt: null, invitedBy: user.id, createdAt: new Date() } });
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5);
  await db.insert(schema.loginTokens).values({ tokenHash: hashToken(token), email, expiresAt });
  const link = `${env.appUrl}/auth/verify?token=${token}`;
  let emailed = false;
  if (p.send && env.smtpUrl) {
    await sendMail(inviteEmail(email, link, user.name || user.email));
    emailed = true;
  }
  return json({ link, email, expiresAt: expiresAt.toISOString(), emailed });
});
