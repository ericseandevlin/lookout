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
const TOKEN = "t".repeat(40);
vi.hoisted(() => {
  process.env.AGENT_TOKEN = "t".repeat(40);
});
let auth = `Bearer ${TOKEN}`;
vi.mock("next/headers", () => ({ headers: async () => new Headers({ authorization: auth }) }));
vi.mock("@/lib/apply", () => ({ autoQueue: vi.fn(async () => {}) }));
vi.mock("@/lib/digest", () => ({ sendDigest: vi.fn(async () => {}) }));

const queue = (await import("./queue/route")).GET;
const complete = (await import("./runs/[id]/complete/route")).POST;

let userId = "";
let searchId = "";

const get = (q = "") => queue(new Request(`https://lookout.test/api/agent/queue${q}`), {});
const post = (id: string, data: unknown) =>
  complete(new Request(`https://lookout.test/api/agent/runs/${id}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {
    params: Promise.resolve({ id }),
  });
const run = async (over: Partial<typeof schema.runs.$inferInsert> = {}) =>
  (await db.insert(schema.runs).values({ userId, searchId, trigger: "manual", status: "queued", request: { type: "discover" }, ...over }).returning())[0];
const reload = async (id: string) => (await db.select().from(schema.runs).where(eq(schema.runs.id, id)))[0];

const find = {
  url: "https://jobs.example.com/acme/123",
  is_open_job_posting: true,
  company: "Acme",
  title: "Director of Design",
  location: "New York, NY (hybrid)",
  work_mode: "Hybrid",
  comp_min: null,
  comp_max: null,
  posted_at: null,
  description: "Lead the design team.",
  score: 5,
  reasons_match: ["You led a team this size"],
  reasons_gap: [],
  location_fit: true,
  dealbreaker: false,
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  auth = `Bearer ${TOKEN}`;
  await db.delete(schema.users);
  const [u] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  userId = u.id;
  [{ id: searchId }] = await db.insert(schema.searches).values({ userId, name: "Job search" }).returning();
});

describe("GET /api/agent/queue", () => {
  it("refuses a wrong token", async () => {
    auth = `Bearer ${"x".repeat(40)}`;
    expect((await get()).status).toBe(401);
  });

  it("peek counts queued jobs without claiming them", async () => {
    const r = await run();
    expect(await (await get("?peek=1")).json()).toEqual({ queued: 1 });
    expect((await reload(r.id)).status).toBe("queued");
  });

  it("claims a queued job and hands back its search's context", async () => {
    const r = await run();
    const { jobs } = await (await get()).json();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ runId: r.id, type: "discover" });
    expect((await reload(r.id)).status).toBe("running");
    // Claimed once: a second poll gets nothing.
    expect((await (await get()).json()).jobs).toHaveLength(0);
  });

  it("fails a claimed job with no search instead of leaving it running (#398)", async () => {
    await db.delete(schema.searches);
    const r = await run({ searchId: null });
    expect((await (await get()).json()).jobs).toHaveLength(0);
    const after = await reload(r.id);
    expect(after.status).toBe("failed");
    expect(after.error).toBe("No search for this job");
  });
});

describe("POST /api/agent/runs/[id]/complete", () => {
  it("saves finds to the run's search and finishes the run (#398)", async () => {
    const r = await run({ status: "running" });
    const res = await post(r.id, { finds: [find] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, added: 1 });
    expect((await reload(r.id)).status).toBe("done");
    const saved = await db.select().from(schema.userOpportunities).where(eq(schema.userOpportunities.userId, userId));
    expect(saved.map((s) => s.searchId)).toEqual([searchId]);
  });

  it("falls back to the active search for an account-level run", async () => {
    const r = await run({ status: "running", searchId: null });
    expect(await (await post(r.id, { finds: [find] })).json()).toMatchObject({ ok: true, added: 1 });
    const saved = await db.select().from(schema.userOpportunities).where(eq(schema.userOpportunities.userId, userId));
    expect(saved.map((s) => s.searchId)).toEqual([searchId]);
  });

  it("fails the run when there is no search to save to", async () => {
    await db.delete(schema.searches);
    const r = await run({ status: "running", searchId: null });
    expect((await post(r.id, { finds: [find] })).status).toBe(409);
    expect((await reload(r.id)).status).toBe("failed");
  });

  it("records an agent error as a failed run", async () => {
    const r = await run({ status: "running" });
    expect((await post(r.id, { error: "Search engine down" })).status).toBe(200);
    const after = await reload(r.id);
    expect(after.status).toBe("failed");
    expect(after.error).toBe("Search engine down");
  });

  it("refuses a job that isn't running", async () => {
    const r = await run();
    expect((await post(r.id, { finds: [] })).status).toBe(409);
  });

  it("404s a bad id", async () => {
    expect((await post("not-a-uuid", {})).status).toBe(404);
  });
});
