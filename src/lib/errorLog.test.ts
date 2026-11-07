import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.mock("server-only", () => ({}));

// recordError takes its time from the database clock, so the test runs at the real now.
const NOW = new Date();
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});

describe("pathOnly", () => {
  it("drops the query string and fragment", async () => {
    const { pathOnly } = await import("./errorLog");
    expect(pathOnly("/auth/verify?token=abc#x")).toBe("/auth/verify");
    expect(pathOnly("/api/finds")).toBe("/api/finds");
    expect(pathOnly("?token=abc")).toBeNull();
    expect(pathOnly(undefined)).toBeNull();
  });
});

describe("error log (#12)", () => {
  it("records errors without the query string, finds them by search, counts day and week", async () => {
    const { recordError, listErrors } = await import("./errorLog");
    await recordError("route", new Error("relation finds does not exist"), { path: "/api/finds?token=secret", method: "GET" });
    await recordError("scheduler", "plain string thrown", { path: "apply sweep" });
    await db.insert(schema.serverErrors).values({ source: "render", message: "old one", at: ago(3) });

    const all = await listErrors("", NOW);
    expect(all.rows.map((r) => r.message).sort()).toEqual(["old one", "plain string thrown", "relation finds does not exist"]);
    expect(all.rows[2].message).toBe("old one");
    const route = all.rows.find((r) => r.source === "route");
    expect(route).toMatchObject({ path: "/api/finds", method: "GET" });
    expect(route?.stack).toContain("relation finds does not exist");
    expect(JSON.stringify(all.rows)).not.toContain("secret");
    expect(all).toMatchObject({ day: 2, week: 3 });

    expect((await listErrors("FINDS", NOW)).rows).toHaveLength(1);
    expect((await listErrors("scheduler", NOW)).rows.map((r) => r.message)).toEqual(["plain string thrown"]);
    // LIKE wildcards in the search are literal.
    expect((await listErrors("%", NOW)).rows).toHaveLength(0);
  });

  it("never throws when the insert fails", async () => {
    const { recordError } = await import("./errorLog");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await expect(recordError("route", new Error("x"))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    spy.mockRestore();
    log.mockRestore();
  });

  it("prunes errors older than 30 days", async () => {
    const { pruneErrors, listErrors } = await import("./errorLog");
    await db.insert(schema.serverErrors).values({ source: "route", message: "ancient", at: ago(31) });
    expect(await pruneErrors(NOW)).toBe(1);
    expect((await listErrors("ancient", NOW)).rows).toHaveLength(0);
    expect((await listErrors("old one", NOW)).rows).toHaveLength(1);
  });
});
