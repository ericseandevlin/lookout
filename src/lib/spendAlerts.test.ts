import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
const sendMail = vi.fn<(mail: { to: string; subject: string }) => Promise<void>>(async () => {});
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendMail }));
let ai = { provider: "openai", baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-test" };
vi.mock("@/lib/config", () => ({ getAiConfig: async () => ai, getAccessConfig: async () => ({ dailyBudgetUsd: 15, userDailyBudgetUsd: 3 }) }));

const { alertDailyCap, checkKeyLimit, keyUsage } = await import("./spendAlerts");

const keyReply = (usage_monthly: number, limit: number | null = 20) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: { usage_monthly, limit, limit_reset: "monthly" } })));
const HOUR = 3600_000;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  sendMail.mockClear();
  ai = { provider: "openai", baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-test" };
  await db.delete(schema.appSettings);
  await db.delete(schema.users);
  await db.insert(schema.users).values([
    { email: "admin@example.com", isAdmin: true },
    { email: "gone@example.com", isAdmin: true, disabled: true },
    { email: "person@example.com" },
  ]);
});

describe("spend alerts (#990)", () => {
  it("reads the key's monthly spend and limit from OpenRouter, and nothing for other providers", async () => {
    const f = keyReply(4.2);
    expect(await keyUsage()).toEqual({ usd: 4.2, limit: 20, reset: "monthly" });
    expect(f.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/key");
    keyReply(4.2, null);
    expect(await keyUsage()).toBeNull();
    ai = { ...ai, baseUrl: "https://api.deepinfra.com/v1/openai" };
    expect(await keyUsage()).toBeNull();
  });

  it("emails active admins once a month when the key passes 70%", async () => {
    let t = new Date("2026-11-13T12:00:00Z").getTime();
    keyReply(10);
    await checkKeyLimit(new Date(t));
    expect(sendMail).not.toHaveBeenCalled();
    keyReply(14.5);
    await checkKeyLimit(new Date((t += 30 * 60_000))); // under an hour: not checked
    expect(sendMail).not.toHaveBeenCalled();
    await checkKeyLimit(new Date((t += HOUR)));
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: "admin@example.com", subject: "Lookout has used 73% of its AI key limit" });
    await checkKeyLimit(new Date((t += HOUR)));
    expect(sendMail).toHaveBeenCalledOnce();
    await checkKeyLimit(new Date("2026-12-02T12:00:00Z"));
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("emails the admins once a day when the daily cap stops work", async () => {
    await alertDailyCap(15.2, new Date("2026-11-13T15:00:00Z"));
    await alertDailyCap(15.4, new Date("2026-11-13T20:00:00Z"));
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: "admin@example.com", subject: "Lookout's daily AI cap stopped searches" });
    await alertDailyCap(15.4, new Date("2026-11-14T15:00:00Z"));
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("sends one cap email when two runs hit the cap at once, and keeps the key alert's month (#1022)", async () => {
    keyReply(15);
    await checkKeyLimit(new Date("2027-01-13T12:00:00Z"));
    expect(sendMail).toHaveBeenCalledOnce();
    const now = new Date("2027-01-13T15:00:00Z");
    await Promise.all([alertDailyCap(16, now), alertDailyCap(16, now), alertDailyCap(16, now)]);
    expect(sendMail).toHaveBeenCalledTimes(2);
    const [row] = await db.select().from(schema.appSettings);
    expect(row.value).toEqual({ keyMonth: "2027-01", capDay: "2027-01-13" });
  });

  it("never throws when the email fails", async () => {
    sendMail.mockRejectedValueOnce(new Error("smtp down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(alertDailyCap(16)).resolves.toBeUndefined();
  });
});
