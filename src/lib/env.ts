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
