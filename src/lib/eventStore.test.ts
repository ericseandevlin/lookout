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
vi.mock("server-only", () => ({}));

const ago = (d: number) => new Date(Date.now() - d * 864e5);
const ANSWERS = { q1: "Director of Design", floor: "180000", modes: ["Remote"], q4: "Design systems", q5: "No agencies" };

beforeAll(async () => {
  process.env.ADMIN_EMAILS = "boss@example.com";
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  delete process.env.ADMIN_EMAILS;
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
});

const user = async (email: string, p: Partial<typeof schema.users.$inferInsert> = {}) => {
  const [u] = await db
    .insert(schema.users)
    .values({ email, ...p })
    .returning();
  return u;
};

describe("track (#368)", () => {
  it("stores the event and cuts the target to 300 characters", async () => {
    const { track } = await import("./eventStore");
    const u = await user("pat@example.com");
    await track(u.id, "page_view", "x".repeat(400), { tab: "finds", n: 2 });
    await track(u.id, "sign_in");
    const rows = await db.select().from(schema.events);
    expect(rows.find((r) => r.type === "page_view")).toMatchObject({ userId: u.id, target: "x".repeat(300), meta: { tab: "finds", n: 2 } });
    expect(rows.find((r) => r.type === "sign_in")).toMatchObject({ target: null, meta: null });
  });

  it("never throws when the insert fails", async () => {
    const { track } = await import("./eventStore");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // No such user: the foreign key fails.
    await expect(track("00000000-0000-0000-0000-000000000000", "sign_in")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[events] not recorded", "sign_in", expect.anything());
    log.mockRestore();
  });
});

describe("activity (#368)", () => {
  it("leaves out admins and disabled accounts and builds the funnel from current data", async () => {
    const { activity } = await import("./eventStore");
    const done = await user("done@example.com", { name: "Dana", lastLoginAt: ago(1), onboardedAt: ago(9) });
    const fresh = await user("fresh@example.com", { lastLoginAt: ago(1) });
    const flagged = await user("admin@example.com", { isAdmin: true, lastLoginAt: ago(1) });
    const boss = await user("Boss@Example.com", { lastLoginAt: ago(1) });
    const off = await user("off@example.com", { disabled: true, lastLoginAt: ago(1) });

    // Dana: answered on her second search, has a resume, a finished scheduled search, a find, and pinned it.
    await db.insert(schema.searches).values({ userId: done.id, name: "Empty", answers: {} });
    const [s] = await db.insert(schema.searches).values({ userId: done.id, name: "Job search", answers: ANSWERS, searchProfileAt: ago(8) }).returning();
    await db.insert(schema.materials).values({ userId: done.id, kind: "resume" });
    await db.insert(schema.runs).values([
      { userId: done.id, searchId: s.id, trigger: "scheduled", status: "done" },
      // A failed search and a resume scan don't count as "had a search run".
      { userId: fresh.id, trigger: "manual", status: "failed" },
      { userId: fresh.id, trigger: "resume", status: "done" },
    ]);
    const [o] = await db.insert(schema.opportunities).values({ company: "Acme", title: "Director", fingerprint: "acme" }).returning();
    await db.insert(schema.userOpportunities).values({ userId: done.id, searchId: s.id, opportunityId: o.id, score: 4, pinned: true });

    await db.insert(schema.events).values([
      { userId: done.id, type: "page_view", at: ago(2) },
      { userId: done.id, type: "heartbeat", at: ago(1) },
      // Heartbeats alone don't make someone active.
      { userId: fresh.id, type: "heartbeat", at: ago(1) },
      { userId: flagged.id, type: "page_view", at: ago(1) },
      { userId: boss.id, type: "page_view", at: ago(1) },
      { userId: off.id, type: "page_view", at: ago(1) },
      // Outside the 8 weeks.
      { userId: fresh.id, type: "page_view", at: ago(70) },
    ]);

    const a = await activity();
    expect(a.weeks).toHaveLength(8);
    // Weekly actives count everyone with a non-heartbeat event, admins included; Dana may span two weeks.
    const actives = a.weeks.reduce((n, w) => n + w.active, 0);
    expect(actives).toBeGreaterThanOrEqual(4);
    expect(actives).toBeLessThanOrEqual(5);
    expect(Object.fromEntries(a.funnel.map((f) => [f.key, f.count]))).toEqual({
      accounts: 2,
      signedIn: 2,
      welcome: 1,
      answered: 1,
      material: 1,
      searchProfile: 1,
      searched: 1,
      found: 1,
      acted: 1,
    });
    expect(a.people).toEqual([
      { id: done.id, who: "Dana", next: null, lastSeen: expect.any(String), events: 1 },
      { id: fresh.id, who: "fresh@example.com", next: "Finished the welcome step", lastSeen: null, events: 0 },
    ]);
  });

  it("counts a stage past Applied as acting on a find", async () => {
    const { activity } = await import("./eventStore");
    const u = await user("pat@example.com");
    const [s] = await db.insert(schema.searches).values({ userId: u.id, name: "Job search", answers: {} }).returning();
    const [o] = await db.insert(schema.opportunities).values({ company: "Acme", title: "Lead", fingerprint: "acme-lead" }).returning();
    await db.insert(schema.userOpportunities).values({ userId: u.id, searchId: s.id, opportunityId: o.id, score: 3, stage: "Interview" });
    const a = await activity();
    expect(a.funnel.find((f) => f.key === "accounts")?.count).toBe(1);
    expect(a.people[0].next).toBe("Signed in");
    // acted is set even though the earlier steps aren't, so the funnel doesn't count it.
    expect(a.funnel.find((f) => f.key === "acted")?.count).toBe(0);
  });
});

describe("eventsFor and timelineFor (#368)", () => {
  it("export is oldest first; the timeline is newest first with heartbeats folded", async () => {
    const { eventsFor, timelineFor } = await import("./eventStore");
    const u = await user("pat@example.com");
    const other = await user("sam@example.com");
    const t0 = Date.now() - 3600_000;
    const at = (min: number) => new Date(t0 + min * 60_000);
    await db.insert(schema.events).values([
      { userId: u.id, type: "page_view", target: "/finds", at: at(0) },
      { userId: u.id, type: "heartbeat", target: "/finds", at: at(1) },
      { userId: u.id, type: "heartbeat", target: "/finds", at: at(2) },
      { userId: u.id, type: "heartbeat", target: "/finds", at: at(3) },
      { userId: u.id, type: "pin", target: "find-1", at: at(4) },
      { userId: other.id, type: "sign_in", at: at(5) },
    ]);

    expect((await eventsFor(u.id)).map((e) => e.type)).toEqual(["page_view", "heartbeat", "heartbeat", "heartbeat", "pin"]);
    const tl = await timelineFor(u.id);
    expect(tl.map((r) => [r.type, r.minutes])).toEqual([
      ["pin", undefined],
      ["heartbeat", 3],
      ["page_view", undefined],
    ]);
    expect(tl[0].at).toBe(at(4).toISOString());
  });
});
