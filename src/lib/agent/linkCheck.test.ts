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

// Each posting URL answers with whatever the test put here: page text, or an error to throw.
const pages = new Map<string, string | Error>();
const fetchPage = vi.fn(async (url: string) => {
  const p = pages.get(url);
  if (p instanceof Error) throw p;
  return { url, html: `<p>${p ?? ""}</p>` };
});
vi.mock("@/lib/ai/fetchPage", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/fetchPage")>()), fetchPage: (u: string) => fetchPage(u) }));

const { FetchError } = await import("@/lib/ai/fetchPage");
const { closeGonePostings } = await import("./linkCheck");

const T0 = new Date("2026-11-01T12:00:00Z");
const hoursLater = (h: number) => new Date(T0.getTime() + h * 3600_000);
let userId = "";
let searchId = "";

async function addFind(url: string, o: { stage?: string; notes?: string; attributes?: Record<string, unknown> } = {}) {
  const [opp] = await db
    .insert(schema.opportunities)
    .values({ company: "Acme", title: "Designer", sourceUrl: url, fingerprint: url, attributes: o.attributes ?? {} })
    .returning();
  await db.insert(schema.userOpportunities).values({ userId, searchId, opportunityId: opp.id, score: 80, stage: o.stage ?? "Not applied", notes: o.notes ?? "" });
  return opp.id;
}
const find = async (opportunityId: string) => {
  const [uo] = await db.select().from(schema.userOpportunities);
  const [o] = await db.select().from(schema.opportunities);
  expect(o.id).toBe(opportunityId);
  return { ...uo, linkCheck: o.attributes.linkCheck as { state: string; goneSince?: string } | undefined };
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  pages.clear();
  fetchPage.mockClear();
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  const [u] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [s] = await db.insert(schema.searches).values({ userId: u.id, name: "Job search" }).returning();
  userId = u.id;
  searchId = s.id;
});

describe("closeGonePostings", () => {
  it("records the first gone result but closes nothing", async () => {
    const id = await addFind("https://jobs.test/1");
    pages.set("https://jobs.test/1", "This job is no longer available.");
    expect(await closeGonePostings(userId, T0)).toBe(0);
    const f = await find(id);
    expect(f.stage).toBe("Not applied");
    expect(f.archived).toBe(false);
    expect(f.linkCheck).toMatchObject({ state: "gone", goneSince: T0.toISOString() });
  });

  it("closes and archives once it's still gone 20 hours later, keeping their notes", async () => {
    const id = await addFind("https://jobs.test/1", { notes: "Ask Sam about this.\n" });
    pages.set("https://jobs.test/1", "This job is no longer available.");
    await closeGonePostings(userId, T0);
    expect(await closeGonePostings(userId, hoursLater(19))).toBe(0);
    expect(await closeGonePostings(userId, hoursLater(20))).toBe(1);
    const f = await find(id);
    expect(f.stage).toBe("Closed");
    expect(f.archived).toBe(true);
    expect(f.notes).toBe("Ask Sam about this.\n\nClosed: the posting was gone (page says it's closed) as of 2026-11-01. Lookout archived it.");
    expect(f.linkCheck?.goneSince).toBe(T0.toISOString());
  });

  it("keeps goneSince through an unknown result and clears it when the posting is up", async () => {
    const id = await addFind("https://jobs.test/1");
    pages.set("https://jobs.test/1", "Page not found");
    await closeGonePostings(userId, T0);
    pages.set("https://jobs.test/1", "Down for maintenance");
    await closeGonePostings(userId, hoursLater(1));
    expect((await find(id)).linkCheck).toMatchObject({ state: "unknown", goneSince: T0.toISOString() });
    pages.set("https://jobs.test/1", "Senior Designer. Apply now.");
    await closeGonePostings(userId, hoursLater(2));
    const lc = (await find(id)).linkCheck;
    expect(lc?.state).toBe("open");
    expect(lc?.goneSince).toBeUndefined();
  });

  it("never checks finds they are pursuing", async () => {
    for (const stage of ["Applied", "Interview", "Offer"]) {
      await db.delete(schema.opportunities);
      const id = await addFind("https://jobs.test/1", { stage, attributes: { linkCheck: { checkedAt: T0.toISOString(), state: "gone", reason: "x", goneSince: T0.toISOString() } } });
      pages.set("https://jobs.test/1", "This job is no longer available.");
      expect(await closeGonePostings(userId, hoursLater(48))).toBe(0);
      expect((await find(id)).stage).toBe(stage);
    }
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("counts a 404 as gone without retrying", async () => {
    const id = await addFind("https://jobs.test/1");
    pages.set("https://jobs.test/1", new FetchError("The page answered 404"));
    await closeGonePostings(userId, T0);
    expect((await find(id)).linkCheck).toMatchObject({ state: "gone", goneSince: T0.toISOString() });
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it("retries an unreachable page, then counts it as unknown", async () => {
    const id = await addFind("https://jobs.test/1");
    pages.set("https://jobs.test/1", new Error("ECONNRESET"));
    await closeGonePostings(userId, T0);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    const lc = (await find(id)).linkCheck;
    expect(lc?.state).toBe("unknown");
    expect(lc?.goneSince).toBeUndefined();
  }, 10_000);
});
