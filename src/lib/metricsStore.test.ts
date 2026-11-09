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
    expect(m.growth.channels).toEqual([
      { channel: "reddit", signups: 2, joined: 2, active: 2 },
      { channel: "direct", signups: 1, joined: 0, active: 0 },
    ]);
    expect(m.growth.invites).toEqual({ sent: 2, accepted: 1, rate: 0.5 });
  });
});
