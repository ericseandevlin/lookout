import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

/**
 * A non-negative number from the environment, or the fallback. A value like "$15" would
 * otherwise become NaN, and `spent >= NaN` is always false, so a spend cap would never fire.
 */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  console.warn(`[env] ${name}=${JSON.stringify(raw)} is not a number; using ${fallback}`);
  return fallback;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** Public origin, e.g. https://paulfinds.pauljustinscott.com. Used in emails and origin checks. */
  get appUrl() {
    return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  },
  get dataDir() {
    return process.env.DATA_DIR || "./data";
  },
  /** Default sign-up mode; admins can change it in the app. "invite" (default) only lets in invited emails. */
  get signupMode(): "open" | "invite" {
    return process.env.SIGNUP_MODE === "open" ? "open" : "invite";
  },
  get allowedEmails() {
    return list(process.env.ALLOWED_EMAILS);
  },
  get adminEmails() {
    return list(process.env.ADMIN_EMAILS);
  },
  get smtpUrl() {
    return process.env.SMTP_URL || "";
  },
  get mailFrom() {
    return process.env.MAIL_FROM || "Lookout <lookout@localhost>";
  },
  /** Where replies go. The From address only sends, so without this, replies are lost. Defaults to the first admin. */
  get mailReplyTo() {
    return process.env.MAIL_REPLY_TO || list(process.env.ADMIN_EMAILS)[0] || "";
  },
  /** Postal address printed at the bottom of news and waitlist mail (#28, CAN-SPAM). Those emails don't send without it. */
  get mailPostalAddress() {
    return (process.env.MAIL_POSTAL_ADDRESS || "").trim();
  },
  /** Print magic links to stdout when no SMTP is configured. Dev only. */
  get logEmails() {
    return process.env.EMAIL_DEV_LOG === "1";
  },
  get schedulerEnabled() {
    return process.env.SCHEDULER !== "off";
  },
  /** How many due searches a scheduler pass runs at once (#988). Kept small: the database pool has 5 connections. */
  get schedulerConcurrency() {
    return Math.max(1, Math.floor(envNumber("SCHEDULER_CONCURRENCY", 3)));
  },
  get timezone() {
    return process.env.APP_TZ || "America/New_York";
  },
  /** Spend caps. A run is refused when either cap would be crossed. */
  get dailyBudgetUsd() {
    return envNumber("DAILY_BUDGET_USD", 15);
  },
  get userDailyBudgetUsd() {
    return envNumber("USER_DAILY_BUDGET_USD", 3);
  },
};

function list(v: string | undefined) {
  return (v || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
