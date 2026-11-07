import { afterEach, describe, expect, it, vi } from "vitest";
import { env, envNumber } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("envNumber", () => {
  it("reads a plain number", () => {
    vi.stubEnv("X_NUM", "12.5");
    expect(envNumber("X_NUM", 1)).toBe(12.5);
  });

  it("uses the fallback when unset or blank, without a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("X_NUM", "");
    expect(envNumber("X_NUM", 7)).toBe(7);
    vi.stubEnv("X_NUM", "  ");
    expect(envNumber("X_NUM", 7)).toBe(7);
    expect(envNumber("X_NUM_UNSET", 7)).toBe(7);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["$15", "15usd", "abc", "-1", "Infinity"])("falls back and warns on %s", (raw) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("X_NUM", raw);
    expect(envNumber("X_NUM", 15)).toBe(15);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("X_NUM");
  });

  it("accepts zero", () => {
    vi.stubEnv("X_NUM", "0");
    expect(envNumber("X_NUM", 3)).toBe(0);
  });
});

describe("spend caps", () => {
  it("default to 15 and 3", () => {
    vi.stubEnv("DAILY_BUDGET_USD", "");
    vi.stubEnv("USER_DAILY_BUDGET_USD", "");
    expect(env.dailyBudgetUsd).toBe(15);
    expect(env.userDailyBudgetUsd).toBe(3);
  });

  it("never become NaN, so the cap check still fires", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DAILY_BUDGET_USD", "$20");
    vi.stubEnv("USER_DAILY_BUDGET_USD", "five");
    expect(env.dailyBudgetUsd).toBe(15);
    expect(env.userDailyBudgetUsd).toBe(3);
    expect(100 >= env.dailyBudgetUsd).toBe(true);
  });

  it("read a set value", () => {
    vi.stubEnv("DAILY_BUDGET_USD", "40");
    vi.stubEnv("USER_DAILY_BUDGET_USD", "4.5");
    expect(env.dailyBudgetUsd).toBe(40);
    expect(env.userDailyBudgetUsd).toBe(4.5);
  });
});

describe("email lists", () => {
  it("split on commas, trim, lowercase and drop blanks", () => {
    vi.stubEnv("ADMIN_EMAILS", " Eric@Example.com, ,b@x.org,");
    vi.stubEnv("ALLOWED_EMAILS", "");
    expect(env.adminEmails).toEqual(["eric@example.com", "b@x.org"]);
    expect(env.allowedEmails).toEqual([]);
  });

  it("send replies to MAIL_REPLY_TO, else the first admin, else nowhere", () => {
    vi.stubEnv("ADMIN_EMAILS", "A@x.org,b@x.org");
    vi.stubEnv("MAIL_REPLY_TO", "help@x.org");
    expect(env.mailReplyTo).toBe("help@x.org");
    vi.stubEnv("MAIL_REPLY_TO", "");
    expect(env.mailReplyTo).toBe("a@x.org");
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(env.mailReplyTo).toBe("");
  });
});

describe("other settings", () => {
  it("drop a trailing slash from APP_URL and default to localhost", () => {
    vi.stubEnv("APP_URL", "https://finds.example.com/");
    expect(env.appUrl).toBe("https://finds.example.com");
    vi.stubEnv("APP_URL", "");
    expect(env.appUrl).toBe("http://localhost:3000");
  });

  it("keep sign-up invite-only unless set to open", () => {
    vi.stubEnv("SIGNUP_MODE", "");
    expect(env.signupMode).toBe("invite");
    vi.stubEnv("SIGNUP_MODE", "Open");
    expect(env.signupMode).toBe("invite");
    vi.stubEnv("SIGNUP_MODE", "open");
    expect(env.signupMode).toBe("open");
  });

  it("run the scheduler unless SCHEDULER=off", () => {
    vi.stubEnv("SCHEDULER", "");
    expect(env.schedulerEnabled).toBe(true);
    vi.stubEnv("SCHEDULER", "off");
    expect(env.schedulerEnabled).toBe(false);
  });

  it("throw a clear error when DATABASE_URL is missing", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => env.databaseUrl).toThrow("Missing required env var DATABASE_URL");
  });
});
