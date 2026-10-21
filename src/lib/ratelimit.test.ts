import { PGlite } from "@electric-sql/pglite";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

const HOUR = 3600_000;
const freshModule = async () => {
  vi.resetModules();
  return (await import("./ratelimit")).rateLimit;
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  vi.useRealTimers();
  await pg.close();
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
  await db.delete(schema.rateLimits);
});

describe("rateLimit", () => {
  it("allows up to the limit, then refuses", async () => {
    const rateLimit = await freshModule();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit("k", 3, HOUR));
    expect(results).toEqual([true, true, true, false]);
    expect(await rateLimit("other", 3, HOUR)).toBe(true);
  });

  it("starts a new window once the old one expires", async () => {
    const rateLimit = await freshModule();
    for (let i = 0; i < 3; i++) await rateLimit("k", 2, HOUR);
    expect(await rateLimit("k", 2, HOUR)).toBe(false);
    vi.setSystemTime(Date.now() + HOUR - 1);
    expect(await rateLimit("k", 2, HOUR)).toBe(false);
    vi.setSystemTime(Date.now() + 1);
    expect(await rateLimit("k", 2, HOUR)).toBe(true);
    expect(await rateLimit("k", 2, HOUR)).toBe(true);
    expect(await rateLimit("k", 2, HOUR)).toBe(false);
  });

  it("keeps counts across a new module instance (a restart)", async () => {
    const before = await freshModule();
    await before("k", 2, HOUR);
    await before("k", 2, HOUR);
    const after = await freshModule();
    expect(after).not.toBe(before);
    expect(await after("k", 2, HOUR)).toBe(false);
  });

  it("deletes expired rows now and then", async () => {
    const rateLimit = await freshModule();
    await rateLimit("old", 5, 60_000);
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await rateLimit("new", 5, HOUR);
    const keys = await db.select({ key: schema.rateLimits.key }).from(schema.rateLimits);
    expect(keys).toEqual([{ key: "new" }]);
    const [{ n }] = await db.select({ n: count() }).from(schema.rateLimits);
    expect(n).toBe(1);
  });
});
