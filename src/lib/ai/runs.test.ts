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

const { assertBudget, BudgetError, spentSince, startBudgetedRun } = await import("./runs");

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

// A finished run of this trigger and cost, so running ones have an average to count at (#1038).
const finished = (userId: string, costUsd: number, trigger: "scheduled" | "manual" = "scheduled") =>
  db.insert(schema.runs).values({ userId, trigger, status: "done", costUsd: String(costUsd), startedAt: new Date(Date.now() - 2 * 3600_000), finishedAt: new Date(Date.now() - 2 * 3600_000) });
const running = (userId: string, minutesAgo = 5, trigger: "scheduled" | "manual" = "scheduled") =>
  db.insert(schema.runs).values({ userId, trigger, status: "running", startedAt: new Date(Date.now() - minutesAgo * 60_000) });
const dayAgo = () => new Date(Date.now() - 24 * 3600_000);

describe("runs in flight (#1038)", () => {
  it("count each running run at the average of recent finished runs of its trigger", async () => {
    await finished(other, 0.4);
    await finished(other, 0.6);
    await finished(other, 9, "manual"); // another trigger's cost doesn't set this estimate
    await running(me);
    expect(await spentSince(dayAgo(), me)).toEqual({ all: 0.4 + 0.6 + 9 + 0.5, mine: 0.5 });
  });

  it("stop a person whose running searches would put them over their cap", async () => {
    await finished(other, 0.9);
    await running(me);
    await expect(assertBudget(me)).resolves.toBeUndefined();
    await running(me);
    await running(me);
    await expect(assertBudget(me)).rejects.toThrow("daily AI spend limit");
  });

  it("don't count a run older than the stuck-run window", async () => {
    await finished(other, 1);
    await running(me, 50);
    expect((await spentSince(dayAgo(), me)).mine).toBe(0);
  });

  it("count as $0 when the trigger has no finished runs yet", async () => {
    await running(me);
    expect(await spentSince(dayAgo(), me)).toEqual({ all: 0, mine: 0 });
  });

  it("let only as many concurrent starts through as the cap allows", async () => {
    // $10 app-wide cap, $3 runs, five people starting at once: 3.00 already spent, so two more fit.
    await finished(other, 3);
    const people = await db.insert(schema.users).values([1, 2, 3, 4, 5].map((n) => ({ email: `p${n}@example.com` }))).returning();
    const results = await Promise.allSettled(people.map((p) => startBudgetedRun(p.id, "scheduled")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof BudgetError)).toBe(true);
  });
});
