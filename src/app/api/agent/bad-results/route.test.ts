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
const TOKEN = "e".repeat(40);
vi.hoisted(() => {
  process.env.AGENT_TOKEN = "t".repeat(40);
  process.env.AGENT_ERRORS_TOKEN = "e".repeat(40);
});
let auth = `Bearer ${TOKEN}`;
vi.mock("next/headers", () => ({ headers: async () => new Headers({ authorization: auth }) }));

const { GET } = await import("./route");
const { runOf } = await import("@/lib/ai/badResults");
const get = (q = "?since=2026-11-05T00:00:00Z") => GET(new Request(`https://lookout.test/api/agent/bad-results${q}`), {});

let userId = "";
let searchId = "";
const opp = async (title: string) => {
  const [o] = await db.insert(schema.opportunities).values({ company: "Acme", title, fingerprint: title }).returning();
  return o.id;
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  auth = `Bearer ${TOKEN}`;
  process.env.AGENT_ERRORS_TOKEN = TOKEN;
  await db.delete(schema.users);
  await db.delete(schema.opportunities);
  [{ id: userId }] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  [{ id: searchId }] = await db.insert(schema.searches).values({ userId, name: "Design" }).returning();
});

describe("GET /api/agent/bad-results (#994)", () => {
  it("is a 404 when AGENT_ERRORS_TOKEN is unset, as on prod", async () => {
    delete process.env.AGENT_ERRORS_TOKEN;
    expect((await get()).status).toBe(404);
  });

  it("refuses the general agent token", async () => {
    auth = `Bearer ${"t".repeat(40)}`;
    expect((await get()).status).toBe(401);
  });

  it("rejects a bad since", async () => {
    expect((await get("?since=last-week")).status).toBe(400);
  });

  it("lists failed runs and applications since the date, with their trace ids", async () => {
    const at = (d: string) => new Date(d);
    const [old] = await db.insert(schema.runs).values({ userId, searchId, trigger: "manual", status: "failed", error: "old", startedAt: at("2026-11-01T00:00:00Z") }).returning();
    const [bad] = await db.insert(schema.runs).values({ userId, searchId, trigger: "scheduled", status: "failed", error: "Model timed out", startedAt: at("2026-11-10T00:00:00Z") }).returning();
    await db.insert(schema.runs).values({ userId, searchId, trigger: "manual", status: "done", startedAt: at("2026-11-10T00:00:00Z") });
    const [app] = await db
      .insert(schema.applications)
      .values({ userId, opportunityId: await opp("Designer"), status: "failed", report: { error: "No form" }, updatedAt: at("2026-11-11T00:00:00Z") })
      .returning();
    const body = await (await get()).json();
    expect(body.failedRuns.map((r: { traceId: string }) => r.traceId)).toEqual([bad.id]);
    expect(body.failedRuns[0]).toMatchObject({ trigger: "scheduled", error: "Model timed out" });
    expect(body.failedRuns.map((r: { traceId: string }) => r.traceId)).not.toContain(old.id);
    expect(body.failedApps).toEqual([expect.objectContaining({ traceId: app.id, error: "No form" })]);
  });

  it("lists recent 'Not a fit' finds, highest score first, with the run that added them and no user id", async () => {
    const [run] = await db
      .insert(schema.runs)
      .values({ userId, searchId, trigger: "manual", status: "done", startedAt: new Date("2026-11-09T10:00:00Z"), finishedAt: new Date("2026-11-09T10:05:00Z") })
      .returning();
    const add = async (title: string, score: number, feedbackAt: string | null) =>
      db.insert(schema.userOpportunities).values({
        userId,
        searchId,
        opportunityId: await opp(title),
        score,
        addedAt: new Date("2026-11-09T10:03:00Z"),
        feedback: feedbackAt ? { reason: `${title} is wrong`, at: feedbackAt } : null,
      });
    await add("Low", 40, "2026-11-10T00:00:00Z");
    await add("High", 90, "2026-11-10T00:00:00Z");
    await add("Earlier", 95, "2026-11-01T00:00:00Z");
    await add("Kept", 99, null);
    const body = await (await get()).json();
    expect(body.notAFit.map((f: { title: string }) => f.title)).toEqual(["High", "Low"]);
    expect(body.notAFit[0]).toMatchObject({ score: 90, reason: "High is wrong", traceId: run.id });
    expect(body.notAFit[0]).not.toHaveProperty("userId");
  });
});

describe("runOf", () => {
  const run = (id: string, start: string, end: string | null) => ({ id, startedAt: new Date(start), finishedAt: end ? new Date(end) : null });
  it("picks the latest run that covers the time, with a minute of slack, or null", () => {
    const runs = [run("a", "2026-11-09T10:00:00Z", "2026-11-09T10:05:00Z"), run("b", "2026-11-09T11:00:00Z", "2026-11-09T11:05:00Z")];
    expect(runOf(new Date("2026-11-09T10:05:30Z"), runs)).toBe("a");
    expect(runOf(new Date("2026-11-09T11:01:00Z"), runs)).toBe("b");
    expect(runOf(new Date("2026-11-09T10:30:00Z"), runs)).toBeNull();
  });
});
