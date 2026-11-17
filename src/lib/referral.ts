import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Personal referral links (#527). Each person's link is the landing page with ?ref=r-<code>, so it rides the
 * same channel plumbing as a channel test. The friend still joins the waitlist; the request records who sent them.
 */
const PREFIX = "r-";

/** Lowercase hex, so the landing page's channel slug leaves it unchanged. */
const newCode = () => randomBytes(5).toString("hex");

/** The person's referral link, making their code the first time. */
export async function referralLink(userId: string) {
  const [me] = await db.select({ code: schema.users.referralCode }).from(schema.users).where(eq(schema.users.id, userId));
  let code = me?.code;
  if (!code) {
    // Only fill an empty code, so two tabs opening Settings at once end up with the same link.
    await db.update(schema.users).set({ referralCode: newCode() }).where(and(eq(schema.users.id, userId), isNull(schema.users.referralCode)));
    [{ code }] = await db.select({ code: schema.users.referralCode }).from(schema.users).where(eq(schema.users.id, userId));
  }
  return `${env.appUrl}/?ref=${PREFIX}${code}`;
}

/** Who a waitlist channel slug points to, when it is someone's referral code. Disabled accounts don't count. */
export async function referrerOf(channel: string | null) {
  if (!channel?.startsWith(PREFIX)) return null;
  const [u] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.referralCode, channel.slice(PREFIX.length)), eq(schema.users.disabled, false)));
  return u?.id ?? null;
}
