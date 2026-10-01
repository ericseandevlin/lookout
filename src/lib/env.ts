import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
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
  /** "open" lets anyone sign up; "invite" only lets in emails already in users or ALLOWED_EMAILS. */
  get signupMode(): "open" | "invite" {
    return process.env.SIGNUP_MODE === "invite" ? "invite" : "open";
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
  /** Print magic links to stdout when no SMTP is configured. Dev only. */
  get logEmails() {
    return process.env.EMAIL_DEV_LOG === "1";
  },
  get model() {
    return process.env.LOOKOUT_MODEL || "claude-opus-5-5";
  },
  get schedulerEnabled() {
    return process.env.SCHEDULER !== "off";
  },
  get timezone() {
    return process.env.APP_TZ || "America/New_York";
  },
  /** Spend caps. A run is refused when either cap would be crossed. */
  get dailyBudgetUsd() {
    return Number(process.env.DAILY_BUDGET_USD || "15");
  },
  get userDailyBudgetUsd() {
    return Number(process.env.USER_DAILY_BUDGET_USD || "3");
  },
};

function list(v: string | undefined) {
  return (v || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
