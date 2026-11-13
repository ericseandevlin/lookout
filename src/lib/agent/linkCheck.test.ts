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

  it("cancels a queued application for a posting it closes, and leaves one further along (#827)", async () => {
    const queued = await addFind("https://jobs.test/1", { stage: "Auto-applying" });
    const drafted = await addFind("https://jobs.test/2", { stage: "Auto-applying" });
    await db.insert(schema.applications).values([
      { userId, opportunityId: queued, queuedBy: "auto", status: "queued" },
      { userId, opportunityId: drafted, queuedBy: "auto", status: "needs_review" },
    ] as (typeof schema.applications.$inferInsert)[]);
    pages.set("https://jobs.test/1", "This job is no longer available.");
    pages.set("https://jobs.test/2", "This job is no longer available.");
    await closeGonePostings(userId, T0);
    expect((await db.select().from(schema.applications)).map((a) => a.status).sort()).toEqual(["needs_review", "queued"]);
    expect(await closeGonePostings(userId, hoursLater(20))).toBe(2);
    const status = Object.fromEntries((await db.select().from(schema.applications)).map((a) => [a.opportunityId, a.status]));
    expect(status).toEqual({ [queued]: "canceled", [drafted]: "needs_review" });
  });

  it("keeps a note they typed while the run was checking links (#656)", async () => {
    const id = await addFind("https://jobs.test/1", { notes: "Old note" });
    pages.set("https://jobs.test/1", "This job is no longer available.");
    await closeGonePostings(userId, T0);
    fetchPage.mockImplementationOnce(async (url: string) => {
      await db.update(schema.userOpportunities).set({ notes: "Typed mid-run" });
      return { url, html: "<p>This job is no longer available.</p>" };
    });
    expect(await closeGonePostings(userId, hoursLater(20))).toBe(1);
    expect((await find(id)).notes).toBe("Typed mid-run\n\nClosed: the posting was gone (page says it's closed) as of 2026-11-01. Lookout archived it.");
  });

  it("checks a posting on two searches once and keeps each search's note (#656)", async () => {
    const id = await addFind("https://jobs.test/1", { notes: "From search one" });
    const [s2] = await db.insert(schema.searches).values({ userId, name: "Second search" }).returning();
    await db.insert(schema.userOpportunities).values({ userId, searchId: s2.id, opportunityId: id, score: 80, notes: "" });
    pages.set("https://jobs.test/1", "This job is no longer available.");
    await closeGonePostings(userId, T0);
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(await closeGonePostings(userId, hoursLater(20))).toBe(1);
    const line = "Closed: the posting was gone (page says it's closed) as of 2026-11-01. Lookout archived it.";
    const notes = (await db.select().from(schema.userOpportunities)).map((r) => [r.searchId === searchId ? 1 : 2, r.notes, r.stage]).sort();
    expect(notes).toEqual([
      [1, `From search one\n\n${line}`, "Closed"],
      [2, line, "Closed"],
    ]);
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

  it("never checks or counts finds they passed on (#614)", async () => {
    const id = await addFind("https://jobs.test/1", { stage: "Nope", attributes: { linkCheck: { checkedAt: T0.toISOString(), state: "gone", reason: "x", goneSince: T0.toISOString() } } });
    pages.set("https://jobs.test/1", "This job is no longer available.");
    expect(await closeGonePostings(userId, hoursLater(48))).toBe(0);
    const f = await find(id);
    expect(f.stage).toBe("Nope");
    expect(f.archived).toBe(false);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("sees closed wording on a page that keeps its JobPosting data (#1026)", async () => {
    const id = await addFind("https://jobs.test/1");
    const ld = JSON.stringify({ "@type": "JobPosting", title: "Designer", description: "You will own end-to-end design for core flows. ".repeat(60) });
    pages.set("https://jobs.test/1", `</p><script type="application/ld+json">${ld}</script><p>This job is no longer available.`);
    await closeGonePostings(userId, T0);
    expect((await find(id)).linkCheck).toMatchObject({ state: "gone", goneSince: T0.toISOString() });
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
  describe("company pages that embed an ATS (#678)", () => {
    const GH = "https://boards-api.greenhouse.io/v1/boards/acme";
    const PAGE = "https://acme.test/careers?gh_jid=123";
    const gone404 = () => new FetchError("The page answered 404");

    it("reads a Greenhouse embed as gone when its board no longer has the job", async () => {
      const id = await addFind(PAGE);
      pages.set(PAGE, "Careers at Acme <script src=https://boards.greenhouse.io/embed/job_board/js?for=acme></script>");
      pages.set(`${GH}/jobs/123`, gone404());
      await closeGonePostings(userId, T0);
      expect((await find(id)).linkCheck).toMatchObject({ state: "gone", reason: "Greenhouse no longer lists the job" });
    });

    it("keeps a Greenhouse embed open while the board still has the job", async () => {
      const id = await addFind(PAGE);
      pages.set(PAGE, "Careers at Acme");
      await closeGonePostings(userId, T0);
      expect((await find(id)).linkCheck?.state).toBe("open");
      expect(fetchPage).toHaveBeenCalledWith(`${GH}/jobs/123`);
    });

    it("never closes on a guessed board that doesn't exist", async () => {
      const id = await addFind(PAGE);
      pages.set(PAGE, "Careers at Acme");
      pages.set(GH, gone404());
      pages.set(`${GH}/jobs/123`, gone404());
      await closeGonePostings(userId, T0);
      expect((await find(id)).linkCheck?.state).toBe("open");
      expect(fetchPage).not.toHaveBeenCalledWith(`${GH}/jobs/123`);
    });

    it("reads an Ashby embed as gone when the org no longer has the job", async () => {
      const jid = "0b5c9f3e-1111-4222-8333-444455556666";
      const url = `https://acme.test/careers?ashby_jid=${jid}`;
      const id = await addFind(url);
      pages.set(url, "Careers at Acme");
      const post = vi.fn(async () => new Response(JSON.stringify({ data: { jobPosting: null } }), { headers: { "content-type": "application/json" } }));
      vi.stubGlobal("fetch", post);
      try {
        await closeGonePostings(userId, T0);
      } finally {
        vi.unstubAllGlobals();
      }
      expect(fetchPage).toHaveBeenCalledWith("https://api.ashbyhq.com/posting-api/job-board/acme");
      expect(JSON.parse((post.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).variables).toEqual({ organizationHostedJobsPageName: "acme", jobPostingId: jid });
      expect((await find(id)).linkCheck).toMatchObject({ state: "gone", reason: "Ashby no longer lists the job" });
    });
  });
});
