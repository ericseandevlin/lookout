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
// The AI key's own count is read from OpenRouter; tested in spendAlerts.test.ts.
vi.mock("./spendAlerts", () => ({ keyUsage: async () => ({ usd: 9, limit: 20, reset: "monthly" }) }));

const NOW = new Date();
const ago = (d: number) => new Date(NOW.getTime() - d * 864e5);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});

describe("metrics (#369)", () => {
  it("leaves out disabled accounts and heartbeats, judges goals on the last full week, and splits cost by month actives", async () => {
    const { metrics } = await import("./metricsStore");
    const [a] = await db.insert(schema.users).values({ email: "a@example.com", createdAt: ago(10) }).returning();
    const [b] = await db.insert(schema.users).values({ email: "b@example.com", createdAt: ago(10) }).returning();
    const [off] = await db.insert(schema.users).values({ email: "off@example.com", createdAt: ago(10), disabled: true }).returning();
    const search = async (userId: string, savedAt: Date | null = null) => (await db.insert(schema.searches).values({ userId, name: "Job search", answers: {}, savedAt }).returning())[0];
    const [sa, sb, so] = [await search(a.id, ago(9)), await search(b.id), await search(off.id, ago(9))];
    await db.insert(schema.materials).values([
      { userId: a.id, kind: "resume" },
      { userId: off.id, kind: "resume" },
    ]);

    const find = async (userId: string, searchId: string, key: string, p: Partial<typeof schema.userOpportunities.$inferInsert> = {}) => {
      const [o] = await db.insert(schema.opportunities).values({ company: "Acme", title: key, fingerprint: key }).returning();
      await db.insert(schema.userOpportunities).values({ userId, searchId, opportunityId: o.id, score: 5, addedAt: ago(8), ...p });
      return o.id;
    };
    await find(a.id, sa.id, "interview", { stage: "Interview", score: 8 });
    await find(a.id, sa.id, "junior", { score: 4, feedback: { reason: "Too junior", at: ago(8).toISOString() } });
    const clicked = await find(a.id, sa.id, "clicked", { score: 6 });
    // Not counted: added by hand, older than 90 days, or a disabled account's.
    await find(b.id, sb.id, "manual", { addedVia: "manual", stage: "Applied" });
    await find(a.id, sa.id, "old", { addedAt: ago(100) });
    await find(off.id, so.id, "offer", { stage: "Offer" });

    await db.insert(schema.runs).values([
      { userId: a.id, searchId: sa.id, trigger: "manual", status: "done", costUsd: "0.5", report: { read: 3 } as never, startedAt: ago(8), finishedAt: ago(8) },
      { userId: b.id, searchId: sb.id, trigger: "scheduled", status: "failed", costUsd: "0.25", startedAt: ago(8), finishedAt: ago(8) },
      { userId: off.id, searchId: so.id, trigger: "manual", status: "done", costUsd: "1", report: { read: 0 } as never, startedAt: ago(9), finishedAt: ago(9) },
    ]);

    const lastWeek = ago(7);
    await db.insert(schema.events).values([
      { userId: a.id, type: "page_view", at: lastWeek },
      { userId: a.id, type: "posting_clicked", target: clicked, at: lastWeek },
      { userId: b.id, type: "page_view", at: lastWeek },
      { userId: off.id, type: "page_view", at: lastWeek },
      { userId: off.id, type: "pin", target: clicked, at: lastWeek },
      // Heartbeats alone don't make someone active.
      { userId: off.id, type: "heartbeat", at: ago(1) },
    ]);

    // Survey (#526): the seeded interviews and offers questions. b reports both with nothing on the board;
    // a's interview is already on the board, and the disabled account is left out.
    const qs = await db.select().from(schema.surveyQuestions);
    const asks = (o: string) => qs.find((q) => q.outcome === o)!.id;
    await db.insert(schema.surveyAnswers).values([
      { questionId: asks("interview"), userId: a.id, answer: "Yes" },
      { questionId: asks("interview"), userId: b.id, answer: "Yes" },
      { questionId: asks("offer"), userId: b.id, answer: "Yes" },
      { questionId: asks("offer"), userId: a.id, answer: "Not yet" },
      { questionId: asks("offer"), userId: off.id, answer: "Yes" },
    ]);

    // Growth (#527): a and b came from reddit, joined and were active last week. A pending direct request,
    // and the disabled account's request, which is left out. Three invites: one revoked, one accepted, one not yet.
    await db.insert(schema.accessRequests).values([
      { email: "a@example.com", channel: "reddit" },
      { email: "b@example.com", channel: "reddit" },
      { email: "new@example.com" },
      { email: "off@example.com", channel: "hn" },
    ]);
    await db.insert(schema.invites).values([{ email: "a@example.com" }, { email: "waiting@example.com" }, { email: "gone@example.com", revokedAt: ago(1) }]);

    // Auto-apply cost (#991): drafted applications only, every account (real spend); one still queued is left out.
    const app = async (userId: string, key: string, report: Record<string, unknown>) => {
      const [o] = await db.insert(schema.opportunities).values({ company: "Acme", title: key, fingerprint: `app-${key}` }).returning();
      await db.insert(schema.applications).values({ userId, opportunityId: o.id, status: "needs_review", report });
    };
    await app(a.id, "one", { draftedAt: ago(2).toISOString(), usd: 0.08 });
    await app(b.id, "two", { draftedAt: ago(1).toISOString(), usd: 0.12 });
    await app(off.id, "three", { draftedAt: ago(1).toISOString(), usd: 0.31 });
    await app(a.id, "queued", { usd: 0.01 });

    const m = await metrics(NOW);
    expect(m.weeklyActives).toBe(2);
    expect(m.actedPerActive).toBe(0.5);
    expect(m.weeks).toHaveLength(8);
    expect(m.weeks[m.weeks.length - 1].week).toBe(m.lastWeek);
    expect(m.interviews).toBe(2);
    expect(m.offers).toBe(1);
    expect(m.outcomes).toEqual({ board: { interviews: 1, offers: 0 }, survey: { interviews: 1, offers: 1 }, questions: 2 });
    expect(m.activation).toEqual({ eligible: 2, activated: 1, rate: 0.5 });
    expect(m.quality).toEqual({ days: 90, added: 3, acted: 2, notFit: 1, topReason: { reason: "Too junior", count: 1 }, score: { acted: 7, ignored: 4 } });
    expect(m.search).toEqual({ searches: 2, succeeded: 1, rate: 0.5 });
    // Cost is real spend, so it includes every account; actives don't.
    expect(m.costMonth).toBe(1.75);
    expect(m.monthActives).toBe(2);
    expect(m.costPerActiveMonth).toBe(0.875);
    expect(m.applyCost).toEqual({ applications: 3, avg: expect.closeTo(0.17), median: 0.12, max: 0.31 });
    // Only the finished searches: a's and the disabled account's.
    expect(m.searchCost).toEqual({ searches: 2, avg: 0.75 });
    expect(m.growth.channels).toEqual([
      { channel: "reddit", signups: 2, joined: 2, active: 2 },
      { channel: "direct", signups: 1, joined: 0, active: 0 },
    ]);
    expect(m.growth.invites).toEqual({ sent: 2, accepted: 1, rate: 0.5 });
  });

  it("adds month-to-date spend per active person and the key's count, and leaves cap skips out of search success (#990)", async () => {
    const { metrics } = await import("./metricsStore");
    await db.delete(schema.users);
    const now = new Date("2026-11-13T12:00:00Z");
    const at = (iso: string) => new Date(iso);
    const [a] = await db.insert(schema.users).values({ email: "mtd-a@example.com" }).returning();
    const [b] = await db.insert(schema.users).values({ email: "mtd-b@example.com" }).returning();
    await db.insert(schema.runs).values([
      { userId: a.id, trigger: "manual", status: "done", costUsd: "1.2", startedAt: at("2026-11-02T10:00:00Z") },
      { userId: b.id, trigger: "scheduled", status: "done", costUsd: "0.3", startedAt: at("2026-11-12T10:00:00Z") },
      // Last month: in the 30-day total, not the month to date.
      { userId: a.id, trigger: "scheduled", status: "done", costUsd: "2", startedAt: at("2026-10-30T10:00:00Z") },
      { userId: b.id, trigger: "scheduled", status: "failed", error: "capped", request: { skipped: "user_cap" }, startedAt: at("2026-11-12T11:00:00Z") },
    ]);
    await db.insert(schema.events).values([
      { userId: a.id, type: "page_view", at: at("2026-11-10T10:00:00Z") },
      { userId: b.id, type: "page_view", at: at("2026-10-28T10:00:00Z") },
    ]);
    const m = await metrics(now);
    expect(m.spend).toEqual({ monthToDate: 1.5, actives: 1, perActive: 1.5, key: { usd: 9, limit: 20, reset: "monthly" } });
    expect(m.costMonth).toBe(3.5);
    expect(m.search.searches).toBe(3);
  });
});
