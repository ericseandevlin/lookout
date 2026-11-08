import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

vi.mock("server-only", () => ({}));
const kick = vi.fn();
vi.mock("@/lib/application/run", () => ({ kick }));
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

const { autoQueue, getAutoApplySettings, listApplications, saveAutoApplySettings } = await import("./apply");

let n = 0;
const user = async (isAdmin = true) => {
  const [u] = await db.insert(schema.users).values({ email: `u${++n}@example.com`, name: "U", isAdmin } as typeof schema.users.$inferInsert).returning();
  const [s] = await db.insert(schema.searches).values({ userId: u.id, name: "Job search" } as typeof schema.searches.$inferInsert).returning();
  return { id: u.id, searchId: s.id };
};
const find = async (u: { id: string; searchId: string }, score: number) => {
  const url = `https://example.com/jobs/${++n}`;
  const [o] = await db.insert(schema.opportunities).values({ title: `Role ${n}`, company: "Acme", sourceUrl: url, fingerprint: url } as typeof schema.opportunities.$inferInsert).returning();
  await db.insert(schema.userOpportunities).values({ userId: u.id, searchId: u.searchId, opportunityId: o.id, stage: "Not applied", score } as typeof schema.userOpportunities.$inferInsert);
  return { id: o.id, score };
};
const queued = async (userId: string) =>
  (await db.select().from(schema.applications).where(eq(schema.applications.userId, userId))).map((a) => a.opportunityId);
const events = async (userId: string) => (await db.select().from(schema.events).where(eq(schema.events.userId, userId))).map((e) => e.type);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
beforeEach(() => {
  kick.mockClear();
  vi.unstubAllEnvs();
  vi.stubEnv("FEATURE_AUTO_APPLY", "on");
});
afterAll(async () => {
  await pg.close();
});

describe("auto-apply settings", () => {
  it("defaults to off, threshold 5, three a day", async () => {
    const u = await user();
    expect(await getAutoApplySettings(u.id)).toEqual({ enabled: false, threshold: 5, dailyCap: 3 });
  });

  it("saves a partial change and keeps the rest", async () => {
    const u = await user();
    await saveAutoApplySettings(u.id, { threshold: 4 });
    expect(await saveAutoApplySettings(u.id, { dailyCap: 1 })).toEqual({ enabled: false, threshold: 4, dailyCap: 1 });
    expect(await getAutoApplySettings(u.id)).toEqual({ enabled: false, threshold: 4, dailyCap: 1 });
  });

  it("records turning it on and off, and nothing for other changes", async () => {
    const u = await user();
    await saveAutoApplySettings(u.id, { threshold: 4 });
    await saveAutoApplySettings(u.id, { enabled: true });
    await saveAutoApplySettings(u.id, { enabled: true, dailyCap: 2 });
    await saveAutoApplySettings(u.id, { enabled: false });
    expect((await events(u.id)).sort()).toEqual(["auto_apply_off", "auto_apply_on"]);
  });
});

describe("autoQueue", () => {
  const on = async (u: { id: string }, patch = {}) => saveAutoApplySettings(u.id, { enabled: true, ...patch });

  it("queues finds at or above the threshold and kicks the runner for each", async () => {
    const u = await user();
    await on(u, { threshold: 4 });
    const [low, edge, high] = [await find(u, 3), await find(u, 4), await find(u, 5)];
    expect(await autoQueue(u.id, [low, edge, high])).toBe(2);
    expect((await queued(u.id)).sort()).toEqual([edge.id, high.id].sort());
    expect(kick).toHaveBeenCalledTimes(2);
    const [app] = await db.select().from(schema.applications).where(and(eq(schema.applications.userId, u.id), eq(schema.applications.opportunityId, high.id)));
    expect(app.queuedBy).toBe("auto");
  });

  it("takes the best finds first when the cap is short", async () => {
    const u = await user();
    await on(u, { threshold: 1, dailyCap: 2 });
    const finds = [await find(u, 2), await find(u, 5), await find(u, 3), await find(u, 4)];
    expect(await autoQueue(u.id, finds)).toBe(2);
    expect((await queued(u.id)).sort()).toEqual([finds[1].id, finds[3].id].sort());
  });

  it("counts earlier auto-queued applications from the last 24 hours against the cap", async () => {
    const u = await user();
    await on(u, { threshold: 1, dailyCap: 2 });
    await autoQueue(u.id, [await find(u, 5)]);
    expect(await autoQueue(u.id, [await find(u, 5), await find(u, 5)])).toBe(1);
    expect(await autoQueue(u.id, [await find(u, 5)])).toBe(0);
    expect(await queued(u.id)).toHaveLength(2);
  });

  it("does not count older or user-queued applications against the cap", async () => {
    const u = await user();
    await on(u, { threshold: 1, dailyCap: 1 });
    const old = await find(u, 5);
    await db.insert(schema.applications).values({ userId: u.id, opportunityId: old.id, queuedBy: "auto", createdAt: new Date(Date.now() - 25 * 3600_000) } as typeof schema.applications.$inferInsert);
    const mine = await find(u, 5);
    await db.insert(schema.applications).values({ userId: u.id, opportunityId: mine.id, queuedBy: "user" } as typeof schema.applications.$inferInsert);
    expect(await autoQueue(u.id, [await find(u, 5)])).toBe(1);
  });

  it("does nothing when the setting is off", async () => {
    const u = await user();
    expect(await autoQueue(u.id, [await find(u, 5)])).toBe(0);
    expect(await queued(u.id)).toEqual([]);
  });

  it("does nothing when the beta switch is off on the server", async () => {
    const u = await user();
    await on(u);
    vi.stubEnv("FEATURE_AUTO_APPLY", "off");
    expect(await autoQueue(u.id, [await find(u, 5)])).toBe(0);
    expect(await queued(u.id)).toEqual([]);
  });

  it("does nothing for someone who is not an admin", async () => {
    const u = await user(false);
    await on(u);
    expect(await autoQueue(u.id, [await find(u, 5)])).toBe(0);
    expect(await queued(u.id)).toEqual([]);
  });

  it("does nothing with no new finds or an unknown user", async () => {
    expect(await autoQueue("00000000-0000-0000-0000-000000000000", [{ id: "x", score: 5 }])).toBe(0);
    const u = await user();
    await on(u);
    expect(await autoQueue(u.id, [])).toBe(0);
  });
});

describe("listApplications", () => {
  it("lists only the user's own applications, with item counts and errors on failed ones", async () => {
    const u = await user();
    const other = await user();
    const [a, b] = [await find(u, 5), await find(u, 4)];
    const [ok] = await db.insert(schema.applications).values({ userId: u.id, opportunityId: a.id, status: "needs_review", ats: "greenhouse" } as typeof schema.applications.$inferInsert).returning();
    await db.insert(schema.applications).values({ userId: u.id, opportunityId: b.id, status: "failed", report: { error: "Form not found" } } as typeof schema.applications.$inferInsert);
    await db.insert(schema.applications).values({ userId: other.id, opportunityId: (await find(other, 5)).id } as typeof schema.applications.$inferInsert);
    await db.insert(schema.applicationItems).values([
      { applicationId: ok.id, kind: "resume", prompt: "Resume" },
      { applicationId: ok.id, kind: "answer", prompt: "Why us?" },
    ] as (typeof schema.applicationItems.$inferInsert)[]);

    const rows = await listApplications(u.id);
    expect(rows).toHaveLength(2);
    const byFind = new Map(rows.map((r) => [r.findId, r]));
    expect(byFind.get(a.id)).toMatchObject({ status: "needs_review", score: 5, items: 2, error: null, ats: "greenhouse", company: "Acme" });
    expect(byFind.get(b.id)).toMatchObject({ status: "failed", score: 4, items: 0, error: "Form not found" });
  });
});
