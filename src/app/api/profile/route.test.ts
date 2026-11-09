import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const put = (data: unknown) =>
  PUT(new Request("https://lookout.test/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {});
const search = async (id: string) => (await db.select().from(schema.searches).where(eq(schema.searches.id, id)))[0];

let activeId: string, otherId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.rateLimits);
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [other] = await db.insert(schema.searches).values({ userId: current.id, name: "RFP search", kind: "rfp", answers: { q1: "untouched" } }).returning();
  const [active] = await db
    .insert(schema.searches)
    .values({ userId: current.id, name: "Job search", answers: { q1: "Design lead", q2: "Remote" }, autofilled: { q1: "resume", q2: "linkedin" } })
    .returning();
  activeId = active.id;
  otherId = other.id;
  await db.insert(schema.settings).values({ userId: current.id, activeSearchId: activeId });
});

describe("PUT /api/profile (#539)", () => {
  it("needs a session", async () => {
    current = null;
    expect((await put({ answers: { q1: "x" } })).status).toBe(401);
  });

  it("merges answers into the active search only", async () => {
    const res = await put({ answers: { q2: "Brooklyn or remote", q3: ["AI", "design systems"] } });
    expect(res.status).toBe(200);
    expect((await search(activeId)).answers).toEqual({ q1: "Design lead", q2: "Brooklyn or remote", q3: ["AI", "design systems"] });
    expect((await search(otherId)).answers).toEqual({ q1: "untouched" });
  });

  it("drops the Filled from tag for keys the person edited", async () => {
    await put({ answers: { q1: "Director of design" }, clearAuto: ["q1"] });
    expect((await search(activeId)).autofilled).toEqual({ q2: "linkedin" });
  });

  it("stamps savedAt on save, and autosave leaves it alone", async () => {
    const auto = await (await put({ answers: { q1: "typing" } })).json();
    expect(auto).toEqual({ ok: true, savedAt: null });
    expect((await search(activeId)).savedAt).toBeNull();
    const saved = await (await put({ save: true })).json();
    expect(saved.savedAt).toEqual((await search(activeId)).savedAt!.toISOString());
    const later = await (await put({ answers: { q1: "still typing" } })).json();
    expect(later.savedAt).toBe(saved.savedAt);
  });

  it("asks for a search first when there isn't one", async () => {
    await db.delete(schema.searches);
    expect((await put({ answers: { q1: "x" } })).status).toBe(409);
  });

  it("refuses an answer over 4000 characters or too many list items", async () => {
    expect((await put({ answers: { q1: "x".repeat(4001) } })).status).toBe(400);
    expect((await put({ answers: { q3: Array.from({ length: 21 }, (_, i) => `t${i}`) } })).status).toBe(400);
    expect((await search(activeId)).answers).toEqual({ q1: "Design lead", q2: "Remote" });
  });
});
