import { createHmac, timingSafeEqual } from "node:crypto";
import { BRAND } from "@/lib/brand";
import { emailShell, escapeHtml, type Mail } from "@/lib/email";

// Waitlist double opt-in and export (#9). The token and CSV parts are pure, so they're tested without a database.

/** How long a confirm link works. Long enough for someone who checks email weekly. */
export const CONFIRM_DAYS = 14;
const DAY = 86_400_000;

const sign = (secret: string, email: string, day: number) => createHmac("sha256", secret).update(`waitlist-confirm:v1:${email}:${day}`).digest("base64url");

/** A link token that names the address and the day it was made. */
export function confirmToken(secret: string, email: string, now = Date.now()) {
  const day = Math.floor(now / DAY);
  return `${Buffer.from(email).toString("base64url")}.${day}.${sign(secret, email, day)}`;
}

/** The address in a confirm token, or null if it was changed or is older than CONFIRM_DAYS. Pass the previous secret too during a rotation. */
export function readConfirmToken(token: string, secrets: string[], now = Date.now()): string | null {
  const [enc, dayStr, sig] = token.split(".");
  const day = Number(dayStr);
  if (!enc || !sig || !Number.isInteger(day)) return null;
  const today = Math.floor(now / DAY);
  if (day > today || today - day > CONFIRM_DAYS) return null;
  const email = Buffer.from(enc, "base64url").toString("utf8");
  if (!email.includes("@")) return null;
  const got = Buffer.from(sig);
  for (const s of secrets) {
    const want = Buffer.from(sign(s, email, day));
    if (want.length === got.length && timingSafeEqual(want, got)) return email;
  }
  return null;
}

/** The one email double opt-in sends. A reply to their own request, so it carries no unsubscribe link (like a sign-in link). */
export function confirmEmail(to: string, link: string): Mail {
  const n = BRAND.name;
  return {
    to,
    subject: `Confirm your spot on the ${n} waitlist`,
    text: `You asked to join the ${n} waitlist. Confirm it's you:\n\n${link}\n\nThe link works for ${CONFIRM_DAYS} days. If you didn't ask for this, ignore this email and you won't hear from us again.`,
    html: emailShell(
      "Confirm it's you",
      `<p style="font-size:14.5px;line-height:1.5;color:#6B6358;margin:0 0 20px">You asked to join the ${escapeHtml(n)} waitlist. Tap the button and you're on it.</p>
<a href="${escapeHtml(link)}" style="display:inline-block;background:#99220F;color:#fff;text-decoration:none;font-weight:600;font-size:14.5px;padding:13px 24px;border-radius:12px">Confirm</a>
<p style="font-size:14px;color:#6B6358;margin:24px 0 0">The link works for ${CONFIRM_DAYS} days. If you didn't ask for this, ignore this email and you won't hear from us again.</p>`,
    ),
  };
}

export type WaitlistRow = {
  email: string;
  status: string;
  kind: string;
  nextMove: string | null;
  searchFor: string | null;
  channel: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  consentVersion: string | null;
};

const COLUMNS: [string, (r: WaitlistRow) => string | null][] = [
  ["email", (r) => r.email],
  ["status", (r) => r.status],
  ["confirmed_at", (r) => r.confirmedAt?.toISOString() ?? null],
  ["joined_at", (r) => r.createdAt.toISOString()],
  ["kind", (r) => r.kind],
  ["next_move", (r) => r.nextMove],
  ["search_for", (r) => r.searchFor],
  ["channel", (r) => r.channel],
  ["consent_version", (r) => r.consentVersion],
];

/**
 * One CSV cell. Quoted when it holds a comma, quote or line break. A cell that starts with = + - @ or a tab
 * gets a leading ' so a spreadsheet shows it as text instead of running it as a formula.
 */
export function csvCell(v: string | null) {
  if (v == null) return "";
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The whole waitlist as CSV, header row first, CRLF line ends (what spreadsheets expect). */
export function waitlistCsv(rows: WaitlistRow[]) {
  const lines = [COLUMNS.map(([h]) => h).join(","), ...rows.map((r) => COLUMNS.map(([, get]) => csvCell(get(r))).join(","))];
  return lines.join("\r\n") + "\r\n";
}
