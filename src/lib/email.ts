import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";

let transport: Transporter | null = null;

export type Mail = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> };

export async function sendMail(mail: Mail) {
  if (!env.smtpUrl) {
    if (env.logEmails) console.log(`[email:dev] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    else console.warn(`[email] SMTP_URL not set; dropped "${mail.subject}" to ${mail.to}`);
    return;
  }
  transport ??= nodemailer.createTransport(env.smtpUrl);
  await transport.sendMail({ from: env.mailFrom, ...(env.mailReplyTo && { replyTo: env.mailReplyTo }), ...mail });
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Shared shell so every email matches the app's palette. */
export function emailShell(title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#EFEEEC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1D1A0F">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EFEEEC;padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:#1D1A0F;color:#fff;padding:22px 26px;font-size:19px;font-weight:700;letter-spacing:-0.01em">Lookout</td></tr>
<tr><td style="padding:26px"><div style="font-size:21px;font-weight:700;margin:0 0 12px">${escapeHtml(title)}</div>${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

export function magicLinkEmail(to: string, link: string): Mail {
  return {
    to,
    subject: "Your Lookout sign-in link",
    text: `Sign in to Lookout:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
    html: emailShell(
      "Sign in to Lookout",
      `<p style="font-size:14.5px;line-height:1.5;color:#6B6358;margin:0 0 20px">Tap the button to sign in. The link works once and expires in 15 minutes.</p>
<a href="${escapeHtml(link)}" style="display:inline-block;background:#99220F;color:#fff;text-decoration:none;font-weight:600;font-size:14.5px;padding:13px 24px;border-radius:12px">Sign in</a>
<p style="font-size:14px;color:#6B6358;margin:24px 0 0">If you didn't ask for this, ignore this email.</p>`,
    ),
  };
}

export function inviteEmail(to: string, link: string, from: string): Mail {
  return {
    to,
    subject: `${from} invited you to Lookout`,
    text: `${from} invited you to Lookout, a search agent that finds roles that fit you and puts them on a board.\n\nSet up your account:\n${link}\n\nThe link works once and expires in 7 days.`,
    html: emailShell(
      "You're invited to Lookout",
      `<p style="font-size:14.5px;line-height:1.5;color:#6B6358;margin:0 0 20px">${escapeHtml(from)} invited you. Lookout searches for roles that fit you every week and puts the matches on a board.</p>
<a href="${escapeHtml(link)}" style="display:inline-block;background:#99220F;color:#fff;text-decoration:none;font-weight:600;font-size:14.5px;padding:13px 24px;border-radius:12px">Set up my account</a>
<p style="font-size:14px;color:#6B6358;margin:24px 0 0">The link works once and expires in 7 days.</p>`,
    ),
  };
}

export function emailChangeEmail(to: string, link: string): Mail {
  return {
    to,
    subject: "Confirm your new Lookout email",
    text: `Confirm this address for your Lookout account:\n\n${link}\n\nThe link works once and expires in 1 hour. If you didn't ask for this, ignore this email.`,
    html: emailShell(
      "Confirm your new email",
      `<p style="font-size:14.5px;line-height:1.5;color:#6B6358;margin:0 0 20px">Tap the button to make this the email you sign in with. The link works once and expires in 1 hour.</p>
<a href="${escapeHtml(link)}" style="display:inline-block;background:#99220F;color:#fff;text-decoration:none;font-weight:600;font-size:14.5px;padding:13px 24px;border-radius:12px">Confirm email</a>
<p style="font-size:14px;color:#6B6358;margin:24px 0 0">If you didn't ask for this, ignore this email.</p>`,
    ),
  };
}
