import "server-only";
import { hashToken, newToken } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import { inviteEmail, sendMail } from "@/lib/email";
import { env } from "@/lib/env";

const INVITE_DAYS = 7;

/** Record an invite and mint a 7-day one-time link; email it when SMTP is set and asked for. */
export async function createInvite(email: string, by: { id: string; name: string; email: string }, send: boolean) {
  await db
    .insert(schema.invites)
    .values({ email, invitedBy: by.id })
    .onConflictDoUpdate({ target: schema.invites.email, set: { revokedAt: null, invitedBy: by.id, createdAt: new Date() } });
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5);
  await db.insert(schema.loginTokens).values({ tokenHash: hashToken(token), email, expiresAt });
  const link = `${env.appUrl}/auth/verify?token=${token}`;
  let emailed = false;
  if (send && env.smtpUrl) {
    await sendMail(inviteEmail(email, link, by.name || by.email));
    emailed = true;
  }
  return { link, email, expiresAt: expiresAt.toISOString(), emailed };
}

export { MAX_BULK } from "@/lib/emailList";

/** Invite several people in one step. One failure doesn't stop the rest; each result says what happened. */
export async function inviteMany(emails: string[], by: { id: string; name: string; email: string }, send: boolean) {
  const results: ({ email: string; link: string; emailed: boolean } | { email: string; error: string })[] = [];
  for (const email of emails) {
    try {
      const r = await createInvite(email, by, send);
      results.push({ email, link: r.link, emailed: r.emailed });
    } catch (e) {
      console.error("invite failed", email, e);
      results.push({ email, error: "Couldn't invite" });
    }
  }
  return results;
}
