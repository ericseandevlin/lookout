import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { getAiConfig, getAccessConfig } from "@/lib/config";
import { emailShell, escapeHtml, sendMail } from "@/lib/email";
import { recordError } from "@/lib/errorLog";
import { isAdmin, normalizeEmail } from "@/lib/users";
import { dayKey, keyAlertDue, monthKey, type KeyUsage } from "./spend";

/** Which alerts already went out: the month of the key alert and the day of the daily-cap alert (#990). */
const KEY = "spend_alerts";
type Sent = { keyMonth?: string; capDay?: string };

async function sent(): Promise<Sent> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY));
  return (row?.value ?? {}) as Sent;
}

async function markSent(patch: Sent) {
  const value = { ...(await sent()), ...patch };
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Admins, the same way the app decides them: the account flag or ADMIN_EMAILS. Disabled accounts get nothing. */
async function adminEmails() {
  const rows = await db.select({ email: schema.users.email, isAdmin: schema.users.isAdmin, disabled: schema.users.disabled }).from(schema.users);
  const off = new Set(rows.filter((r) => r.disabled).map((r) => normalizeEmail(r.email)));
  const all = [...rows.filter((r) => !r.disabled && isAdmin(r)).map((r) => normalizeEmail(r.email)), ...env.adminEmails.map(normalizeEmail)];
  return [...new Set(all)].filter((e) => !off.has(e));
}

async function mailAdmins(subject: string, lines: string[]) {
  const to = await adminEmails();
  const link = `${env.appUrl.replace(/\/$/, "")}/admin/metrics`;
  const html = emailShell(
    subject,
    lines.map((l) => `<p style="font-size:14.5px;line-height:1.5;color:#6B6358;margin:0 0 14px">${escapeHtml(l)}</p>`).join("") +
      `<a href="${escapeHtml(link)}" style="display:inline-block;background:#99220F;color:#fff;text-decoration:none;font-weight:600;font-size:14.5px;padding:13px 24px;border-radius:12px">Open Admin &gt; Metrics</a>`,
  );
  for (const addr of to) await sendMail({ to: addr, subject, text: `${lines.join("\n\n")}\n\n${link}`, html });
}

/**
 * The AI key's own spend this month and its limit. OpenRouter only: GET /key reports both (#990).
 * Null for other providers, a key with no limit, or when the call fails.
 */
export async function keyUsage(): Promise<KeyUsage | null> {
  const ai = await getAiConfig();
  if (ai.provider !== "openai" || !ai.apiKey || !/openrouter\.ai/.test(ai.baseUrl)) return null;
  try {
    const res = await fetch(`${ai.baseUrl.replace(/\/$/, "")}/key`, { headers: { Authorization: `Bearer ${ai.apiKey}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data?: { limit?: number | null; usage_monthly?: number; limit_reset?: string | null } };
    if (!data || typeof data.limit !== "number" || data.limit <= 0) return null;
    return { usd: Number(data.usage_monthly ?? 0), limit: data.limit, reset: data.limit_reset ?? null };
  } catch {
    return null;
  }
}

let lastKeyCheck = 0;

/** Once an hour from the scheduler: email the admins the first time this month the key passes 70% of its limit. */
export async function checkKeyLimit(now = new Date()) {
  if (now.getTime() - lastKeyCheck < 3600_000) return;
  lastKeyCheck = now.getTime();
  const u = await keyUsage();
  if (!u) return;
  const month = monthKey(now);
  if (!keyAlertDue(u, (await sent()).keyMonth, month)) return;
  await markSent({ keyMonth: month });
  const pct = Math.round((u.usd / u.limit) * 100);
  await mailAdmins(`Lookout has used ${pct}% of its AI key limit`, [
    `The AI key has spent $${u.usd.toFixed(2)} of its $${u.limit.toFixed(2)} limit this month.`,
    `At the limit, every search and application stops until the key resets${u.reset === "monthly" ? " on the 1st" : ""}. Raise the limit on the key at openrouter.ai to keep them running.`,
  ]);
}

/**
 * The app-wide daily cap stopped AI work: email the admins, once a day. Never throws; the caller is
 * already reporting the cap to the person or the scheduler (#990).
 */
export async function alertDailyCap(spentUsd: number, now = new Date()) {
  try {
    const day = dayKey(now, env.timezone);
    if ((await sent()).capDay === day) return;
    await markSent({ capDay: day });
    const cap = (await getAccessConfig()).dailyBudgetUsd;
    await mailAdmins("Lookout's daily AI cap stopped searches", [
      `AI spend in the last 24 hours reached $${spentUsd.toFixed(2)}, at or over the $${cap.toFixed(2)} cap for everyone.`,
      "Scheduled searches and new AI work wait until spend from the last 24 hours drops below the cap. Raise it under Admin > Daily spend caps if that is too low.",
    ]);
  } catch (e) {
    console.error("[spend] daily cap alert failed", e);
    void recordError("scheduler", e, { path: "spend alert: daily cap" });
  }
}
