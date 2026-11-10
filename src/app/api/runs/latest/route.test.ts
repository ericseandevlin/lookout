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
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let current: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => current, refreshSession: async () => {} }));

const { GET } = await import("./route");

const latest = () => GET(new Request("https://lookout.test/api/runs/latest"), {});
const at = (min: number) => new Date(Date.UTC(2026, 10, 9, 12, min));

let job = "";
let rfp = "";

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  [{ id: job }, { id: rfp }] = await db
    .insert(schema.searches)
    .values([
      { userId: current.id, name: "Job search" },
      { userId: current.id, kind: "rfp", name: "RFP search" },
    ])
    .returning();
  await db.insert(schema.settings).values({ userId: current.id, activeSearchId: job });
});

describe("GET /api/runs/latest (#8, #256, #595)", () => {
  it("needs a session", async () => {
    current = null;
    expect((await latest()).status).toBe(401);
  });

  it("asks for a search first when the account has none", async () => {
    await db.delete(schema.searches);
    const res = await latest();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Create a search first.");
  });

  it("is null before the active search has run", async () => {
    const res = await latest();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run: null });
  });

  it("follows the active search's newest run, not another search's", async () => {
    await db.insert(schema.runs).values([
      { userId: current!.id, searchId: job, trigger: "scheduled", status: "done", startedAt: at(0), finishedAt: at(5), found: 12, added: 3 },
      { userId: current!.id, searchId: job, trigger: "manual", status: "done", startedAt: at(10), finishedAt: at(15), found: 8, added: 2 },
      { userId: current!.id, searchId: rfp, trigger: "manual", status: "running", startedAt: at(20) },
    ]);
    const { run } = await (await latest()).json();
    expect(run).toMatchObject({ trigger: "manual", status: "done", found: 8, added: 2, startedAt: at(10).toISOString(), finishedAt: at(15).toISOString() });
  });

  it("switches with the active search", async () => {
    await db.insert(schema.runs).values({
      userId: current!.id,
      searchId: rfp,
      trigger: "manual",
      status: "running",
      startedAt: at(20),
      progress: { pct: 40, step: "Reading postings", log: [{ at: at(20).toISOString(), text: "Searching" }] },
    });
    await db.update(schema.settings).set({ activeSearchId: rfp });
    const { run } = await (await latest()).json();
    expect(run).toMatchObject({ status: "running", pct: 40, step: "Reading postings", log: [{ at: at(20).toISOString(), text: "Searching" }], finishedAt: null });
  });
});
