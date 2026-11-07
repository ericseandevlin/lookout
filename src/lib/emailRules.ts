import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { escapeHtml as esc } from "@/lib/email";

// Email rules (#28, CAN-SPAM). Sign-in links and invites are transactional and exempt. Anything
// else sent in bulk (news, waitlist updates, the finds email) carries an unsubscribe link and
// Lookout's postal address, and honors an opt-out right away. Rules for writing it: docs/email-rules.md.

/** Which mail an unsubscribe link turns off. "news" covers marketing and waitlist mail. */
export type MailList = "news" | "digest";
const LISTS: MailList[] = ["news", "digest"];

const sign = (secret: string, list: MailList, email: string) =>
  createHmac("sha256", secret).update(`unsubscribe:v1:${list}:${email}`).digest("base64url");

/** A token that names the address and list. It never expires, as CAN-SPAM wants links to keep working. */
export function unsubscribeToken(secret: string, list: MailList, email: string) {
  return `${list}.${Buffer.from(email).toString("base64url")}.${sign(secret, list, email)}`;
}

/** The address and list in a token, or null if it was changed. Pass the previous secret too during a rotation. */
export function readUnsubscribeToken(token: string, secrets: string[]): { list: MailList; email: string } | null {
  const [list, enc, sig] = token.split(".");
  if (!LISTS.includes(list as MailList) || !enc || !sig) return null;
  const email = Buffer.from(enc, "base64url").toString("utf8");
  if (!email.includes("@")) return null;
  const got = Buffer.from(sig);
  for (const s of secrets) {
    const want = Buffer.from(sign(s, list as MailList, email));
    if (want.length === got.length && timingSafeEqual(want, got)) return { list: list as MailList, email };
  }
  return null;
}

/** Headers for one-click unsubscribe in mail apps (RFC 8058). */
export const unsubscribeHeaders = (apiLink: string) => ({ "List-Unsubscribe": `<${apiLink}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

/** The bottom of a bulk email: why they got it, how to stop it, and the postal address. */
export function mailFooter(o: { why: string; link: string; address: string }) {
  const html = `<p style="font-size:13px;line-height:1.5;color:#6B6358;margin:24px 0 0;padding-top:16px;border-top:1px solid #EEEAE4">${esc(o.why)} <a href="${esc(o.link)}" style="color:#6B6358">Unsubscribe</a>.${
    o.address ? `<br>Lookout · ${esc(o.address)}` : ""
  }</p>`;
  const text = `${o.why} Unsubscribe: ${o.link}${o.address ? `\nLookout · ${o.address}` : ""}`;
  return { html, text };
}
