import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.mock("server-only", () => ({}));

const ago = (d: number) => new Date(Date.now() - d * 864e5);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});

describe("findsQuality (#369)", () => {
  it("counts finds Lookout added in 90 days per person and search, and digest clicks per person", async () => {
    const { findsQuality } = await import("./qualityStore");
    const [a] = await db.insert(schema.users).values({ email: "a@example.com", name: "Ann" }).returning();
    const [b] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
    const [sa] = await db.insert(schema.searches).values({ userId: a.id, name: "Job search", answers: {} }).returning();
    const [sb] = await db.insert(schema.searches).values({ userId: b.id, name: "Job search", answers: {} }).returning();

    const runAt = ago(3);
    const [run] = await db
      .insert(schema.runs)
      .values({ userId: a.id, searchId: sa.id, trigger: "manual", status: "done", startedAt: runAt, finishedAt: new Date(runAt.getTime() + 5 * 60_000), added: 2 })
      .returning();
    // Not listed as searches: a resume scan and a failed search.
    await db.insert(schema.runs).values([
      { userId: a.id, trigger: "resume", status: "done", startedAt: ago(2), finishedAt: ago(2) },
      { userId: b.id, searchId: sb.id, trigger: "scheduled", status: "failed", startedAt: ago(2) },
    ]);

    const find = async (userId: string, searchId: string, key: string, p: Partial<typeof schema.userOpportunities.$inferInsert> = {}) => {
      const [o] = await db.insert(schema.opportunities).values({ company: "Acme", title: key, fingerprint: key }).returning();
      await db.insert(schema.userOpportunities).values({ userId, searchId, opportunityId: o.id, score: 5, ...p });
      return o.id;
    };
    const during = new Date(runAt.getTime() + 60_000);
    const seen = await find(a.id, sa.id, "seen", { addedAt: during, seenAt: ago(2) });
    await find(a.id, sa.id, "pinned", { addedAt: during, pinned: true, stage: "Applied" });
    await find(b.id, sb.id, "not-fit", { addedAt: ago(10), feedback: { reason: "Too junior", at: ago(9).toISOString() } });
    // Not counted: added by hand, or older than 90 days.
    await find(a.id, sa.id, "manual", { addedVia: "manual", addedAt: ago(1) });
    await find(a.id, sa.id, "old", { addedAt: ago(100) });

    const [d1] = await db.insert(schema.digests).values({ userId: a.id, finds: 2, sentAt: ago(2) }).returning();
    await db.insert(schema.digests).values({ userId: a.id, finds: 1, sentAt: ago(9) });
    await db.insert(schema.digests).values({ userId: b.id, finds: 1, sentAt: ago(100) });
    // One click on a find and two on the board link.
    await db.insert(schema.digestClicks).values([{ digestId: d1.id, opportunityId: seen }, { digestId: d1.id }, { digestId: d1.id }]);

    const q = await findsQuality();
    expect(q.days).toBe(90);
    expect(q.total).toEqual({ added: 3, opened: 1, pinned: 1, applied: 1, notFit: 1, acted: 1 });
    expect(q.people.map((p) => [p.who, p.added, p.acted])).toEqual([
      ["Ann", 2, 1],
      ["b@example.com", 1, 0],
    ]);
    expect(q.reasons).toEqual([{ reason: "Too junior", count: 1 }]);
    expect(q.weeks).toHaveLength(8);
    expect(q.weeks.reduce((n, w) => n + w.added, 0)).toBe(3);
    expect(q.searches).toEqual([{ id: run.id, who: "Ann", trigger: "manual", at: runAt.toISOString(), added: 2, opened: 1, pinned: 1, applied: 1, notFit: 0, acted: 1 }]);
    expect(q.email.people).toEqual([{ id: a.id, who: "Ann", sent: 2, clicked: 1, findClicks: 1 }]);
    expect(q.email.recent.map((r) => [r.finds, r.findClicks, r.board])).toEqual([
      [2, 1, true],
      [1, 0, false],
    ]);
  });
});
