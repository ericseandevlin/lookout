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
// The run itself is not under test: record that it was started, and nothing more.
const discover = vi.fn(async () => ({ found: 0, added: 0 }));
vi.mock("@/lib/agent/discover", async (orig) => ({ ...(await orig<typeof import("@/lib/agent/discover")>()), discover }));
let ai: { provider: string; model: string } = { provider: "anthropic", model: "claude-test" };
const budget = { dailyBudgetUsd: 10, userDailyBudgetUsd: 1 };
vi.mock("@/lib/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/config")>()),
  getAiConfig: async () => ai,
  getAccessConfig: async () => budget,
}));

const { POST } = await import("./route");

const post = () => POST(new Request("https://lookout.test/api/runs", { method: "POST" }), {});
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

const answers = {
  q1: "Director of Events at a flagship venue",
  floor: "140000",
  modes: ["Hybrid"],
  q4: "Grew event revenue 38% in two years",
  q5: "No relocation",
};
let searchId = "";
const addResume = (status: "scanning" | "done" | "failed") =>
  db.insert(schema.materials).values({ userId: current!.id, kind: "resume", status, fileName: "cv.pdf" });
const addRun = (v: Partial<typeof schema.runs.$inferInsert>) => db.insert(schema.runs).values({ userId: current!.id, trigger: "manual", ...v });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  discover.mockClear();
  ai = { provider: "anthropic", model: "claude-test" };
  await db.delete(schema.rateLimits);
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "maya@example.com" }).returning();
  [{ id: searchId }] = await db.insert(schema.searches).values({ userId: current.id, name: "Job search", answers }).returning();
  await addResume("done");
});

describe("POST /api/runs (#456)", () => {
  it("starts the active search and says so with a 202", async () => {
    const res = await post();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(discover).toHaveBeenCalledWith(searchId, "manual");
    const events = await db.select().from(schema.events);
    expect(events).toEqual([expect.objectContaining({ userId: current!.id, type: "search_run", target: "manual" })]);
  });

  it("needs a session", async () => {
    current = null;
    expect((await post()).status).toBe(401);
    expect(discover).not.toHaveBeenCalled();
  });

  it("refuses while a run is queued or running", async () => {
    await addRun({ status: "queued" });
    const res = await post();
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatch(/already running/);
    expect(discover).not.toHaveBeenCalled();
  });

  it("refuses with no search", async () => {
    await db.delete(schema.searches);
    const res = await post();
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("Create a search first.");
  });

  it("applies the board's readiness rule: five answers, then a resume Lookout has read", async () => {
    await db.update(schema.searches).set({ answers: { q1: "Director of Events" } });
    expect(await errorOf(await post())).toBe("Answer the 5 profile questions to search.");
    await db.update(schema.searches).set({ answers });
    await db.delete(schema.materials);
    expect(await errorOf(await post())).toBe("Add your resume to search.");
    await addResume("scanning");
    const res = await post();
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("Lookout is still reading your resume.");
    expect(discover).not.toHaveBeenCalled();
  });

  it("refuses a kind that has no source switched on", async () => {
    // RFP searches need a SAM.gov key, which the test env doesn't have (#272).
    const rfp = { q1: "Website redesigns for city agencies", naics: "541511", certs: "WOSB", floor: "50000", geo: "New York State" };
    await db.update(schema.searches).set({ kind: "rfp", answers: rfp });
    const res = await post();
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatch(/isn't on yet/);
    expect(discover).not.toHaveBeenCalled();
  });

  it("stops at the person's daily spend cap, and at the whole app's", async () => {
    await addRun({ status: "done", costUsd: "1.5" });
    let res = await post();
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toMatch(/today's search limit/);
    await db.delete(schema.runs);
    const [other] = await db.insert(schema.users).values({ email: "other@example.com" }).returning();
    await db.insert(schema.runs).values({ userId: other.id, trigger: "scheduled", status: "done", costUsd: "12" });
    res = await post();
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toMatch(/daily spend cap/);
    expect(discover).not.toHaveBeenCalled();
  });

  it("says search isn't set up when no model is configured, unless an external agent runs searches", async () => {
    ai = { provider: "anthropic", model: "" };
    const res = await post();
    expect(res.status).toBe(503);
    expect(discover).not.toHaveBeenCalled();
    ai = { provider: "agent", model: "" };
    expect((await post()).status).toBe(202);
  });

  it("allows 3 on-demand searches a day", async () => {
    // discover is mocked, so no run is left going to block the next call.
    for (let i = 0; i < 3; i++) expect((await post()).status).toBe(202);
    const res = await post();
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toMatch(/3 times a day/);
    expect(discover).toHaveBeenCalledTimes(3);
  });
});
