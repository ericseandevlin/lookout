import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { emailShell, sendMail } from "@/lib/email";
import { mailFooter, type MailList, readUnsubscribeToken, unsubscribeHeaders, unsubscribeToken } from "@/lib/emailRules";
import { env } from "@/lib/env";
import { normalizeEmail } from "@/lib/users";

// Sending and stopping bulk mail (#28). Everything that isn't a sign-in link, invite or email
// change goes through here, so the unsubscribe link, postal address and opt-out check can't be skipped.

function secrets() {
  const now = process.env.APP_SECRET;
  if (!now || now.length < 32) throw new Error("APP_SECRET must be set (32+ chars) to sign unsubscribe links");
  const prev = process.env.APP_SECRET_PREVIOUS;
  return prev && prev.length >= 32 ? [now, prev] : [now];
}

/** The footer and headers that let this person stop this kind of mail. */
export function unsubscribeParts(list: MailList, email: string, why: string) {
  const t = unsubscribeToken(secrets()[0], list, normalizeEmail(email));
  const footer = mailFooter({ why, link: `${env.appUrl}/unsubscribe?t=${t}`, address: env.mailPostalAddress });
  return { footer, headers: unsubscribeHeaders(`${env.appUrl}/api/unsubscribe?t=${t}`) };
}

export const readToken = (token: string) => readUnsubscribeToken(token, secrets());

/** True when the address unsubscribed from news and waitlist mail. */
export async function isOptedOut(email: string) {
  const [row] = await db.select({ email: schema.emailOptOuts.email }).from(schema.emailOptOuts).where(eq(schema.emailOptOuts.email, normalizeEmail(email)));
  return !!row;
}

/** Stop a list for an address. Takes effect at once, well inside CAN-SPAM's 10 business days. */
export async function optOut(list: MailList, email: string, source = "link") {
  const e = normalizeEmail(email);
  if (list === "news") {
    await db.insert(schema.emailOptOuts).values({ email: e, source }).onConflictDoNothing();
    return;
  }
  const users = db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${e}`);
  await db.update(schema.settings).set({ digest: false }).where(inArray(schema.settings.userId, users));
}

export type NewsMail = { to: string; subject: string; title: string; bodyHtml: string; text: string };

/**
 * Send marketing or waitlist mail. Refuses without a postal address, skips anyone who opted out,
 * and adds the unsubscribe link (in the footer and as one-click headers).
 */
export async function sendNewsMail(m: NewsMail): Promise<"sent" | "opted_out"> {
  if (!env.mailPostalAddress) throw new Error("MAIL_POSTAL_ADDRESS isn't set; news and waitlist mail can't send without it (CAN-SPAM, #28)");
  if (await isOptedOut(m.to)) return "opted_out";
  const { footer, headers } = unsubscribeParts("news", m.to, "You're getting this because you asked for a Lookout invite or have an account.");
  await sendMail({ to: m.to, subject: m.subject, text: `${m.text}\n\n--\n${footer.text}`, html: emailShell(m.title, m.bodyHtml + footer.html), headers });
  return "sent";
}
