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
// Caps: $10 a day across everyone, $2 a day per person.
const alertDailyCap = vi.fn(async () => {});
vi.mock("@/lib/spendAlerts", () => ({ alertDailyCap }));
vi.mock("@/lib/config", () => ({ getAccessConfig: async () => ({ signupMode: "invite", dailyBudgetUsd: 10, userDailyBudgetUsd: 2 }) }));

const { assertBudget, BudgetError } = await import("./runs");

let me = "";
let other = "";
const spend = (userId: string, costUsd: number, hoursAgo = 1) =>
  db.insert(schema.runs).values({ userId, trigger: "manual", costUsd: String(costUsd), startedAt: new Date(Date.now() - hoursAgo * 3600_000) });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  [{ id: me }, { id: other }] = await db.insert(schema.users).values([{ email: "me@example.com" }, { email: "other@example.com" }]).returning();
});

describe("assertBudget", () => {
  it("passes with no spend and under both caps", async () => {
    await expect(assertBudget(me)).resolves.toBeUndefined();
    await spend(me, 1.99);
    await spend(other, 8);
    await expect(assertBudget(me)).resolves.toBeUndefined();
  });

  it("stops everyone once the last 24 hours reach the daily cap", async () => {
    await spend(other, 6);
    await spend(other, 4);
    await expect(assertBudget(me)).rejects.toThrow("Lookout hit its daily spend cap");
    await expect(assertBudget(me)).rejects.toBeInstanceOf(BudgetError);
  });

  it("stops one person at their own cap without stopping others", async () => {
    await spend(me, 1.5);
    await spend(me, 0.5);
    await expect(assertBudget(me)).rejects.toThrow("daily AI spend limit");
    await expect(assertBudget(other)).resolves.toBeUndefined();
  });

  it("ignores runs older than 24 hours", async () => {
    await spend(me, 5, 25);
    await spend(other, 20, 25);
    await expect(assertBudget(me)).resolves.toBeUndefined();
  });
});
