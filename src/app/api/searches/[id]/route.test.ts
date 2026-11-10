import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let current: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => current, refreshSession: async () => {} }));

const { PATCH } = await import("./route");

const rename = (id: string, data: unknown) =>
  PATCH(new Request(`https://lookout.test/api/searches/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {
    params: Promise.resolve({ id }),
  });
const nameOf = async (id: string) => (await db.select().from(schema.searches).where(eq(schema.searches.id, id)))[0].name;

let mine = "";
let theirs = "";

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_SEARCHES = "on";
  await db.delete(schema.users);
  const [other] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  [{ id: mine }, { id: theirs }] = await db
    .insert(schema.searches)
    .values([
      { userId: current.id, name: "Job search" },
      { userId: other.id, name: "Someone else's" },
    ])
    .returning();
});
afterEach(() => {
  delete process.env.FEATURE_SEARCHES;
});

describe("PATCH /api/searches/[id] (#8, #595)", () => {
  it("needs a session", async () => {
    current = null;
    expect((await rename(mine, { name: "Design leadership" })).status).toBe(401);
  });

  it("is not there with the searches feature off", async () => {
    delete process.env.FEATURE_SEARCHES;
    expect((await rename(mine, { name: "Design leadership" })).status).toBe(404);
    expect(await nameOf(mine)).toBe("Job search");
  });

  it("renames your search, trimmed", async () => {
    const res = await rename(mine, { name: "  Design leadership  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await nameOf(mine)).toBe("Design leadership");
  });

  it("refuses someone else's search", async () => {
    expect((await rename(theirs, { name: "Mine now" })).status).toBe(404);
    expect(await nameOf(theirs)).toBe("Someone else's");
  });

  it("refuses an id that isn't a uuid, or a search that doesn't exist", async () => {
    expect((await rename("not-a-uuid", { name: "X" })).status).toBe(404);
    expect((await rename("00000000-0000-4000-8000-000000000000", { name: "X" })).status).toBe(404);
  });

  it("refuses a blank or too long name", async () => {
    expect((await rename(mine, { name: "   " })).status).toBe(400);
    expect((await rename(mine, { name: "x".repeat(81) })).status).toBe(400);
    expect((await rename(mine, {})).status).toBe(400);
    expect(await nameOf(mine)).toBe("Job search");
  });
});
