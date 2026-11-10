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

const { PUT } = await import("./route");

const pick = (data: unknown) =>
  PUT(new Request("https://lookout.test/api/searches/current", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {});
const activeId = async () => (await db.select().from(schema.settings).where(eq(schema.settings.userId, current!.id)))[0].activeSearchId;

let first = "";
let second = "";
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
  [{ id: first }, { id: second }, { id: theirs }] = await db
    .insert(schema.searches)
    .values([
      { userId: current.id, name: "Job search" },
      { userId: current.id, kind: "rfp", name: "RFP search" },
      { userId: other.id, name: "Someone else's" },
    ])
    .returning();
  await db.insert(schema.settings).values({ userId: current.id, activeSearchId: first });
});
afterEach(() => {
  delete process.env.FEATURE_SEARCHES;
});

describe("PUT /api/searches/current (#8, #595)", () => {
  it("needs a session", async () => {
    current = null;
    expect((await pick({ id: second })).status).toBe(401);
  });

  it("is not there with the searches feature off", async () => {
    delete process.env.FEATURE_SEARCHES;
    expect((await pick({ id: second })).status).toBe(404);
    expect(await activeId()).toBe(first);
  });

  it("switches the active search to another of yours", async () => {
    const res = await pick({ id: second });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await activeId()).toBe(second);
  });

  it("refuses someone else's search and keeps yours active", async () => {
    expect((await pick({ id: theirs })).status).toBe(404);
    expect((await pick({ id: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    expect(await activeId()).toBe(first);
  });

  it("refuses an id that isn't a uuid", async () => {
    expect((await pick({ id: "not-a-uuid" })).status).toBe(400);
    expect((await pick({})).status).toBe(400);
    expect(await activeId()).toBe(first);
  });
});
