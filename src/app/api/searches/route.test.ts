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

const { GET, POST } = await import("./route");

const get = () => GET(new Request("https://lookout.test/api/searches"), {});
const post = (data: unknown) =>
  POST(new Request("https://lookout.test/api/searches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {});
const activeId = async () => (await db.select().from(schema.settings).where(eq(schema.settings.userId, current!.id)))[0].activeSearchId;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_SEARCHES = "on";
  await db.delete(schema.rateLimits);
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  await db.insert(schema.settings).values({ userId: current.id });
});
afterEach(() => {
  delete process.env.FEATURE_SEARCHES;
});

describe("/api/searches (#8, #543)", () => {
  it("needs a session", async () => {
    current = null;
    expect((await get()).status).toBe(401);
    expect((await post({ kind: "job" })).status).toBe(401);
  });

  it("lists only this account's searches", async () => {
    const [other] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
    await db.insert(schema.searches).values([
      { userId: current!.id, name: "Job search" },
      { userId: other.id, name: "Someone else's" },
    ]);
    const { searches } = await (await get()).json();
    expect(searches.map((s: { name: string }) => s.name)).toEqual(["Job search"]);
    expect(Object.keys(searches[0]).sort()).toEqual(["id", "kind", "name"]);
  });

  it("creates a search with the kind's default name and makes it active", async () => {
    const res = await post({ kind: "job" });
    expect(res.status).toBe(201);
    const { search } = await res.json();
    expect(search).toMatchObject({ name: "Job search", kind: "job" });
    expect(await activeId()).toBe(search.id);
    const second = (await (await post({ kind: "job" })).json()).search;
    expect(second.name).toBe("Job search 2");
    expect(await activeId()).toBe(second.id);
  });

  it("keeps a name the person typed, and falls back to a job search for an unknown kind", async () => {
    const { search } = await (await post({ kind: "nonsense", name: "  Design roles  " })).json();
    expect(search).toMatchObject({ name: "Design roles", kind: "job" });
  });

  it("is not found with the SEARCHES feature off", async () => {
    delete process.env.FEATURE_SEARCHES;
    expect((await post({ kind: "job" })).status).toBe(404);
    expect(await db.select().from(schema.searches)).toHaveLength(0);
  });

  it("stops after 10 new searches in a day", async () => {
    for (let i = 0; i < 10; i++) expect((await post({ kind: "job" })).status).toBe(201);
    expect((await post({ kind: "job" })).status).toBe(429);
  });
});
