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

const { loadContext, save, realDate } = await import("./discover");
const { fingerprint, legacyFingerprint, suffixedFingerprint, unspelledFingerprint } = await import("./rules");
type Ctx = Awaited<ReturnType<typeof loadContext>>;
type Find = Parameters<typeof save>[1][number];

let userId = "";
let searchId = "";

const find = (over: Partial<Find> = {}): Find => ({
  index: 0,
  url: "https://jobs.example.com/acme/123",
  is_open_job_posting: true,
  company: "Acme",
  title: "Director of Design",
  location: "New York, NY (hybrid)",
  work_mode: "Hybrid",
  comp_min: 200000,
  comp_max: 250000,
  posted_at: "2026-11-01",
  description: "Lead the design team.",
  score: 5,
  reasons_match: ["You led a team this size"],
  reasons_gap: [],
  location_fit: true,
  dealbreaker: false,
  ...over,
});

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  searchId,
  kind: "job",
  userId,
  brief: "",
  resume: "",
  linkedin: "",
  links: [],
  searchProfile: null,
  rejected: [],
  floor: null,
  knownUrls: [],
  answers: {},
  hasResume: false,
  ...over,
});

const board = (sid = searchId) =>
  db
    .select({ title: schema.opportunities.title, company: schema.opportunities.company, score: schema.userOpportunities.score, via: schema.userOpportunities.addedVia, gap: schema.userOpportunities.reasonsGap })
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(eq(schema.userOpportunities.searchId, sid));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  await db.delete(schema.opportunities);
  const [u] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [s] = await db.insert(schema.searches).values({ userId: u.id, name: "Job search", answers: { floor: "$180k" } }).returning();
  userId = u.id;
  searchId = s.id;
});

describe("save", () => {
  it("adds a posting and reports it as new", async () => {
    const r = await save(ctx(), [find()], "agent");
    expect(r).toMatchObject({ postings: 1, added: 1, known: 0, notPostings: 0 });
    expect(r.newFinds).toHaveLength(1);
    expect(await board()).toEqual([{ title: "Director of Design", company: "Acme", score: 5, via: "agent", gap: [] }]);
  });

  it("skips pages that are not one open posting, or lack a company or title", async () => {
    const r = await save(ctx(), [find({ is_open_job_posting: false }), find({ company: "" }), find({ title: "" })], "agent");
    expect(r).toMatchObject({ notPostings: 3, postings: 0, added: 0 });
    expect(await board()).toHaveLength(0);
  });

  it("on a search, skips list pages and board home pages the agent sent as postings (#1631)", async () => {
    const r = await save(ctx(), [find({ url: "https://jobs.lever.co/acme" }), find({ url: "https://www.linkedin.com/jobs/search/?keywords=director%20of%20design", company: "Beta" })], "agent");
    expect(r).toMatchObject({ notPostings: 2, postings: 0, added: 0 });
    expect(await board()).toHaveLength(0);
  });

  it("on a search, skips URLs already on the board, ignoring tracking params and www", async () => {
    const r = await save(ctx({ knownUrls: ["https://www.jobs.example.com/acme/123/?utm_source=x"] }), [find()], "agent");
    expect(r).toMatchObject({ postings: 1, known: 1, added: 0 });
    expect(await board()).toHaveLength(0);
  });

  it("counts the same URL twice in one search once, and not as already on the board (#1531)", async () => {
    const r = await save(ctx(), [find(), find({ title: "Director, Design" })], "agent");
    expect(r).toMatchObject({ added: 1, known: 0, postings: 1 });
  });

  it("counts one posting at two links in one search once, and not as already on the board (#1531)", async () => {
    const r = await save(ctx(), [find(), find({ url: "https://boards.example.org/acme-director" })], "agent");
    expect(r).toMatchObject({ added: 1, known: 0, postings: 1 });
    expect(await board()).toHaveLength(1);
  });

  it("counts the same posting at a different URL as known when it is already on the board", async () => {
    await save(ctx(), [find()], "agent");
    const r = await save(ctx(), [find({ url: "https://boards.example.org/acme-director" })], "agent");
    expect(r).toMatchObject({ added: 0, known: 1 });
    expect(await board()).toHaveLength(1);
  });

  it("counts a board posting found at a new link only as known, never off location, dealbreaker or under the floor (#1109)", async () => {
    await save(ctx({ floor: 180000 }), [find()], "agent");
    const other = "https://boards.example.org/acme-director";
    for (const f of [find({ url: other, location_fit: false }), find({ url: other, dealbreaker: true }), find({ url: other, comp_min: 120000, comp_max: 150000 })]) {
      const r = await save(ctx({ floor: 180000 }), [f], "agent");
      expect(r).toMatchObject({ postings: 1, known: 1, added: 0, offLocation: 0, dealbreaker: 0, belowFloor: 0 });
    }
    expect(await board()).toEqual([expect.objectContaining({ title: "Director of Design", score: 5 })]);
  });

  it("counts one job at two links cut as a dealbreaker once (#1637)", async () => {
    const r = await save(ctx(), [find({ dealbreaker: true }), find({ url: "https://www.linkedin.com/jobs/view/4012345678", dealbreaker: true })], "agent");
    expect(r).toMatchObject({ postings: 1, dealbreaker: 1, added: 0, known: 0 });
    expect(await board()).toHaveLength(0);
    expect(await db.select().from(schema.opportunities)).toHaveLength(0);
  });

  it("counts one job at two links cut under the floor once, and skips a later copy that reads no pay (#1637)", async () => {
    const under = { comp_min: 120000, comp_max: 150000 };
    const r = await save(
      ctx({ floor: 180000 }),
      [
        find({ url: "https://job-boards.greenhouse.io/acme/jobs/4012345", ...under }),
        find({ url: "https://www.linkedin.com/jobs/view/4012345678", ...under }),
        find({ url: "https://boards.example.org/acme-director", comp_min: null, comp_max: null }),
      ],
      "agent",
    );
    expect(r).toMatchObject({ postings: 1, belowFloor: 1, added: 0, known: 0 });
    expect(await board()).toHaveLength(0);
    expect(await db.select().from(schema.opportunities)).toHaveLength(0);
  });

  it("drops dealbreakers on a search but keeps them when the person adds the link", async () => {
    expect(await save(ctx(), [find({ dealbreaker: true })], "agent")).toMatchObject({ dealbreaker: 1, added: 0 });
    const manual = await save(ctx({ knownUrls: ["https://jobs.example.com/acme/123"] }), [find({ dealbreaker: true })], "manual");
    expect(manual).toMatchObject({ dealbreaker: 0, added: 1, known: 0 });
    expect((await board())[0].via).toBe("manual");
  });

  it("reads a range given high to low as low to high, so its top judges the floor (#1526)", async () => {
    const r = await save(ctx({ floor: 180000 }), [find({ comp_min: 200000, comp_max: 150000 })], "agent");
    expect(r).toMatchObject({ added: 1, belowFloor: 0 });
    const [o] = await db.select({ min: schema.opportunities.compMin, max: schema.opportunities.compMax }).from(schema.opportunities);
    expect(o).toEqual({ min: 150000, max: 200000 });
  });

  it("leaves off pay that tops out under the floor; marks down off-location roles (#740)", async () => {
    const r = await save(
      ctx({ floor: 180000 }),
      [find({ comp_min: 120000, comp_max: 150000 }), find({ url: "https://jobs.example.com/b", company: "Beta", location_fit: false })],
      "agent",
    );
    expect(r).toMatchObject({ added: 1, belowFloor: 1, offLocation: 1 });
    const rows = await board();
    expect(rows.map((x) => [x.company, x.score])).toEqual([["Beta", 3]]);
  });

  it("keeps a range that reaches the floor and a posting with no pay (#740)", async () => {
    const r = await save(
      ctx({ floor: 180000 }),
      [find({ comp_min: 150000, comp_max: 180000 }), find({ url: "https://jobs.example.com/b", company: "Beta", comp_min: null, comp_max: null })],
      "agent",
    );
    expect(r).toMatchObject({ added: 2, belowFloor: 0 });
  });

  it("still adds an under-floor role when the person adds the link, marked down (#740)", async () => {
    const r = await save(ctx({ floor: 180000 }), [find({ comp_min: 120000, comp_max: 150000 })], "manual");
    expect(r).toMatchObject({ added: 1, belowFloor: 1 });
    const rows = await board();
    expect(rows[0].score).toBe(3);
    expect(rows[0].gap[0]).toMatch(/below your floor/);
  });

  it("stores pay in another currency with its currency, and leaves the USD floor out of it (#1095)", async () => {
    const r = await save(ctx({ floor: 100000 }), [find({ comp_min: 60000, comp_max: 70000, currency: "GBP" })], "agent");
    expect(r).toMatchObject({ added: 1, belowFloor: 0 });
    const [o] = await db.select().from(schema.opportunities);
    expect(o).toMatchObject({ compMin: 60000, compMax: 70000, currency: "GBP" });
    const [row] = await board();
    expect(row.score).toBe(5);
    expect(row.gap).toEqual([]);
  });

  it("judges a shared posting by the currency of the pay already stored (#1095)", async () => {
    await save(ctx(), [find({ comp_min: 60000, comp_max: 70000, currency: "GBP" })], "manual");
    const r = await save(ctx({ floor: 100000, searchId: (await db.insert(schema.searches).values({ userId, name: "Second", answers: {} }).returning())[0].id }), [find({ url: "https://boards.example.org/acme-director", comp_min: 60000, comp_max: 70000 })], "agent");
    expect(r).toMatchObject({ added: 1, belowFloor: 0 });
  });

  it("stores bad dates and Unknown work mode as empty, and rounds pay", async () => {
    await save(ctx(), [find({ posted_at: "last week", work_mode: "Unknown", comp_min: 199999.6, comp_max: null })], "agent");
    const [o] = await db.select().from(schema.opportunities);
    expect(o).toMatchObject({ postedAt: null, workMode: null, compMin: 200000, compMax: null });
  });

  it("stores an hourly or monthly rate as no pay, not an annual salary below the floor (#702)", async () => {
    await save(ctx({ floor: 180000 }), [find({ comp_min: 65, comp_max: 8500 })], "agent");
    const [o] = await db.select().from(schema.opportunities);
    expect(o).toMatchObject({ compMin: null, compMax: null });
    const [row] = await board();
    expect(row.score).toBe(5);
    expect(row.gap).toEqual(["No comp posted"]);
  });

  it("stores impossible dates and out-of-range pay as empty instead of failing the run (#626)", async () => {
    const out = await save(ctx(), [find({ posted_at: "2026-02-30", comp_min: 20000000000, comp_max: -5 }), find({ url: "https://jobs.example.com/acme/124", title: "Head of Design", posted_at: "2024-02-29" })], "agent");
    expect(out.added).toBe(2);
    const rows = await db.select().from(schema.opportunities);
    expect(rows.find((o) => o.title === "Director of Design")).toMatchObject({ postedAt: null, compMin: null, compMax: null });
    expect(rows.find((o) => o.title === "Head of Design")?.postedAt).toBe("2024-02-29");
  });

  it("keeps one shared posting when two people find it", async () => {
    const [u2] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
    const [s2] = await db.insert(schema.searches).values({ userId: u2.id, name: "Job search", answers: {} }).returning();
    await save(ctx(), [find()], "agent");
    const r = await save(ctx({ userId: u2.id, searchId: s2.id }), [find({ url: "https://boards.example.org/acme-director" })], "agent");
    expect(r.added).toBe(1);
    expect(await db.select().from(schema.opportunities)).toHaveLength(1);
    expect(await board(s2.id)).toHaveLength(1);
  });

  it("keeps the shared posting's link and summary when someone finds it again at another URL (#585)", async () => {
    const [u2] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
    const [s2] = await db.insert(schema.searches).values({ userId: u2.id, name: "Job search", answers: {} }).returning();
    await save(ctx(), [find()], "agent");
    await save(ctx({ userId: u2.id, searchId: s2.id }), [find({ url: "https://boards.example.org/acme-director", description: "Someone else's summary." })], "agent");
    await save(ctx(), [find({ url: "https://aggregator.example.net/job/9", description: "Another summary." })], "agent");
    const [o] = await db.select().from(schema.opportunities);
    expect(o).toMatchObject({ sourceUrl: "https://jobs.example.com/acme/123", description: "Lead the design team." });
  });

  it("fills pay, date and work mode a later read finds when the shared posting has none, and keeps stored ones (#846)", async () => {
    await save(ctx(), [find({ comp_min: null, comp_max: null, posted_at: null, work_mode: "Unknown" })], "agent");
    const [u2] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
    const [s2] = await db.insert(schema.searches).values({ userId: u2.id, name: "Job search", answers: {} }).returning();
    await save(ctx({ userId: u2.id, searchId: s2.id }), [find({ url: "https://boards.example.org/acme-director" })], "agent");
    const [o] = await db.select().from(schema.opportunities);
    expect(o).toMatchObject({ sourceUrl: "https://jobs.example.com/acme/123", compMin: 200000, compMax: 250000, postedAt: "2026-11-01", workMode: "Hybrid" });
    // A third read with other values changes nothing already stored, and pay is never half replaced.
    await save(ctx(), [find({ url: "https://aggregator.example.net/job/9", comp_min: 150000, comp_max: null, posted_at: "2026-11-09", work_mode: "Remote" })], "agent");
    const [again] = await db.select().from(schema.opportunities);
    expect(again).toMatchObject({ compMin: 200000, compMax: 250000, postedAt: "2026-11-01", workMode: "Hybrid" });
  });

  it("scores a shared posting on the pay it keeps, not this read's (#879)", async () => {
    await save(ctx(), [find({ comp_min: 120000, comp_max: 150000 })], "manual");
    const [u2] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
    const [s2] = await db.insert(schema.searches).values({ userId: u2.id, name: "Job search", answers: {} }).returning();
    // No pay on this read, or a range above the floor: the stored $120k to $150k is still what the card shows.
    for (const [i, pay] of [{ comp_min: null, comp_max: null }, { comp_min: 200000, comp_max: 250000 }].entries()) {
      const r = await save(ctx({ userId: u2.id, searchId: s2.id, floor: 180000 }), [find({ url: `https://boards.example.org/acme-director-${i}`, ...pay })], "agent");
      expect(r).toMatchObject({ added: 0, belowFloor: 1 });
    }
    expect(await board(s2.id)).toEqual([]);
    // A link the person adds still goes on, marked down, and without a false "No comp posted".
    await save(ctx({ userId: u2.id, searchId: s2.id, floor: 180000 }), [find({ url: "https://boards.example.org/acme-director-9", comp_min: null, comp_max: null })], "manual");
    const [row] = await board(s2.id);
    expect(row.score).toBe(3);
    expect(row.gap).toContain("Top of the posted range is below your floor");
    expect(row.gap).not.toContain("No comp posted");
  });

  it("keeps a stored one-ended range as is when a later read has both ends (#846)", async () => {
    await save(ctx(), [find({ comp_min: 190000, comp_max: null })], "agent");
    await save(ctx(), [find({ url: "https://boards.example.org/acme-director", comp_min: 200000, comp_max: 250000 })], "agent");
    const [o] = await db.select().from(schema.opportunities);
    expect(o).toMatchObject({ compMin: 190000, compMax: null });
  });

  it("takes a repost's link, summary and date when the shared posting was found gone, and drops the old check (#830)", async () => {
    await save(ctx(), [find()], "agent");
    const goneCheck = { linkCheck: { checkedAt: "2026-11-01T00:00:00.000Z", state: "gone", reason: "404", goneSince: "2026-10-30T00:00:00.000Z" } };
    await db.update(schema.opportunities).set({ attributes: { ...goneCheck, other: 1 } });
    const [u2] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
    const [s2] = await db.insert(schema.searches).values({ userId: u2.id, name: "Job search", answers: {} }).returning();
    const r = await save(ctx({ userId: u2.id, searchId: s2.id }), [find({ url: "https://jobs.example.com/acme/456", description: "Reposted.", posted_at: "2026-11-10" })], "agent");
    expect(r.added).toBe(1);
    const [o] = await db.select().from(schema.opportunities);
    expect(o).toMatchObject({ sourceUrl: "https://jobs.example.com/acme/456", description: "Reposted.", postedAt: "2026-11-10", attributes: { other: 1 } });
    expect(o.attributes).not.toHaveProperty("linkCheck");
  });

  it("keeps a gone posting's check when it is found again at the same URL (#830)", async () => {
    await save(ctx(), [find()], "agent");
    const goneCheck = { linkCheck: { checkedAt: "2026-11-01T00:00:00.000Z", state: "gone", reason: "404", goneSince: "2026-10-30T00:00:00.000Z" } };
    await db.update(schema.opportunities).set({ attributes: goneCheck });
    const [u2] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
    const [s2] = await db.insert(schema.searches).values({ userId: u2.id, name: "Job search", answers: {} }).returning();
    await save(ctx({ userId: u2.id, searchId: s2.id }), [find({ description: "Other." })], "agent");
    const [o] = await db.select().from(schema.opportunities);
    expect(o).toMatchObject({ sourceUrl: "https://jobs.example.com/acme/123", description: "Lead the design team.", attributes: goneCheck });
  });

  describe("a repost of a find the link check closed (#922)", () => {
    const closedLine = "Closed: the posting was gone (404) as of 2026-10-31. Lookout archived it.";
    const repost = () => find({ url: "https://jobs.example.com/acme/456" });
    // The find saved, then closed the way closeGonePostings closes it.
    const closeIt = async (closedFrom: string | null, notes = `Ask Sam.\n\n${closedLine}`) => {
      await save(ctx(), [find()], "agent");
      const goneCheck = { linkCheck: { checkedAt: "2026-11-01T00:00:00.000Z", state: "gone", reason: "404", goneSince: "2026-10-30T00:00:00.000Z" } };
      await db.update(schema.opportunities).set({ attributes: goneCheck });
      await db.update(schema.userOpportunities).set({ stage: "Closed", archived: true, closedFrom, notes });
    };
    const mine = async () => (await db.select().from(schema.userOpportunities))[0];

    it("brings back one closed before they applied, as new", async () => {
      await closeIt("Not applied");
      const r = await save(ctx({ knownUrls: ["https://jobs.example.com/acme/123"] }), [repost()], "agent");
      expect(r).toMatchObject({ postings: 1, added: 1, known: 0 });
      expect(r.newFinds).toHaveLength(1);
      expect(await mine()).toMatchObject({ stage: "Not applied", archived: false, closedFrom: null, notes: "Ask Sam." });
    });

    it("dates one it brings back today, so the finds email has it (#1363)", async () => {
      await closeIt("Not applied");
      await db.update(schema.userOpportunities).set({ addedAt: new Date(Date.now() - 14 * 864e5) });
      const before = Date.now();
      await save(ctx(), [repost()], "agent");
      expect((await mine()).addedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it("keeps the date of one it keeps closed", async () => {
      await closeIt("Ghosted");
      const old = new Date(Date.now() - 14 * 864e5);
      await db.update(schema.userOpportunities).set({ addedAt: old });
      await save(ctx(), [repost()], "agent");
      expect((await mine()).addedAt).toEqual(old);
    });

    it("brings back one closed while auto-applying", async () => {
      await closeIt("Auto-applying", closedLine);
      const r = await save(ctx(), [repost()], "agent");
      expect(r.added).toBe(1);
      expect(await mine()).toMatchObject({ stage: "Not applied", archived: false, notes: "" });
    });

    it("keeps one closed after they applied closed, with a note of the new link", async () => {
      await closeIt("Ghosted");
      const r = await save(ctx(), [repost()], "agent");
      expect(r).toMatchObject({ added: 0, known: 1 });
      const uo = await mine();
      expect(uo).toMatchObject({ stage: "Closed", archived: true, closedFrom: "Ghosted" });
      expect(uo.notes).toMatch(new RegExp(`^Ask Sam\\.\\n\\n${closedLine.replace(/[.()]/g, "\\$&")}\\n\\nReposted on \\d{4}-\\d{2}-\\d{2}: https://jobs\\.example\\.com/acme/456$`));
    });

    it("keeps one closed before the stage was recorded closed, with the note", async () => {
      await closeIt(null);
      const r = await save(ctx(), [repost()], "agent");
      expect(r.added).toBe(0);
      expect(await mine()).toMatchObject({ stage: "Closed", archived: true });
      expect((await mine()).notes).toContain("Reposted on ");
    });

    it("leaves a find they closed themselves alone", async () => {
      await closeIt(null, "Not for me.");
      await save(ctx(), [repost()], "agent");
      expect(await mine()).toMatchObject({ stage: "Closed", notes: "Not for me." });
    });

    it("does nothing when it is found again at the same link", async () => {
      await closeIt("Not applied");
      const r = await save(ctx(), [find()], "agent");
      expect(r.added).toBe(0);
      expect(await mine()).toMatchObject({ stage: "Closed", archived: true });
    });
  });

  it("keeps two jobs apart when only a title parenthetical and the ATS job differ (#838)", async () => {
    const gh = (id: number) => `https://job-boards.greenhouse.io/acme/jobs/${id}`;
    await save(ctx(), [find({ url: gh(111), title: "Senior Product Designer (Payments)" })], "agent");
    const t = await save(ctx(), [find({ url: gh(222), title: "Senior Product Designer (Identity)" })], "agent");
    expect(t.added).toBe(1);
    expect((await board()).map((r) => r.title).sort()).toEqual(["Senior Product Designer (Identity)", "Senior Product Designer (Payments)"]);
    const opps = await db.select().from(schema.opportunities);
    expect(opps.map((o) => [o.title, o.sourceUrl]).sort()).toEqual([
      ["Senior Product Designer (Identity)", gh(222)],
      ["Senior Product Designer (Payments)", gh(111)],
    ]);
    // Found again by another search, the second job lands on its own row, not a third.
    const [s2] = await db.insert(schema.searches).values({ userId, name: "Two", answers: {} }).returning();
    await save(ctx({ searchId: s2.id }), [find({ url: gh(222), title: "Senior Product Designer (Identity)" })], "agent");
    expect(await db.select().from(schema.opportunities)).toHaveLength(2);
  });

  it("still merges the same job under a parenthetical, at another URL or with no job ID (#838)", async () => {
    await save(ctx(), [find({ url: "https://job-boards.greenhouse.io/acme/jobs/111", title: "Director of Design" })], "agent");
    await save(ctx(), [find({ url: "https://boards.greenhouse.io/acme/jobs/111", title: "Director of Design (Rainbow Room)" })], "agent");
    await save(ctx(), [find({ url: "https://careers.acme.com/director", title: "Director of Design (Brand)" })], "agent");
    await save(ctx(), [find({ url: "https://job-boards.greenhouse.io/acme/jobs/222", title: "Director of Design" })], "agent");
    const opps = await db.select().from(schema.opportunities);
    expect(opps.map((o) => o.sourceUrl)).toEqual(["https://job-boards.greenhouse.io/acme/jobs/111"]);
  });

  it("merges a job board copy of an ATS job whose title has a bracket the other lacks (#1679)", async () => {
    const gh = "https://job-boards.greenhouse.io/acme/jobs/4001234005";
    await save(ctx(), [find({ url: gh, title: "Product Designer (Remote)" })], "agent");
    const t = await save(ctx(), [find({ url: "https://www.linkedin.com/jobs/view/3901234567", title: "Product Designer" })], "agent");
    expect(t.added).toBe(0);
    expect((await db.select().from(schema.opportunities)).map((o) => o.sourceUrl)).toEqual([gh]);
  });

  it("still keeps two LinkedIn jobs apart when only a parenthetical and the job differ (#1679)", async () => {
    const li = (id: number) => `https://www.linkedin.com/jobs/view/${id}`;
    await save(ctx(), [find({ url: li(3901234999), title: "Product Designer (Payments)" })], "agent");
    const t = await save(ctx(), [find({ url: li(3901235000), title: "Product Designer (Identity)" })], "agent");
    expect(t.added).toBe(1);
    expect(await db.select().from(schema.opportunities)).toHaveLength(2);
  });

  it("puts a job board copy of a split ATS job on that job's row, not the first's (#1679)", async () => {
    const gh = (id: number) => `https://job-boards.greenhouse.io/acme/jobs/${id}`;
    await save(ctx(), [find({ url: gh(111), title: "Senior Product Designer (Payments)" })], "agent");
    await save(ctx(), [find({ url: gh(222), title: "Senior Product Designer (Identity)" })], "agent");
    const t = await save(ctx(), [find({ url: "https://www.linkedin.com/jobs/view/3901234567", title: "Senior Product Designer (Identity)" })], "agent");
    expect(t.added).toBe(0);
    const opps = await db.select().from(schema.opportunities);
    expect(opps.map((o) => o.sourceUrl).sort()).toEqual([gh(111), gh(222)]);
  });

  it("merges an accented name with its plain spelling (#1269)", async () => {
    await save(ctx(), [find({ url: "https://jobs.example.com/a", company: "L'Oréal", location: "Montréal, QC" })], "agent");
    const t = await save(ctx(), [find({ url: "https://jobs.example.com/b", company: "L'Oreal", location: "Montreal, QC" })], "agent");
    expect(t.added).toBe(0);
    expect(await db.select().from(schema.opportunities)).toHaveLength(1);
  });

  it("matches a posting stored under the key from before #1269, not a second row", async () => {
    const old = legacyFingerprint("L'Oréal", "Director of Design", "Montréal, QC");
    await db.insert(schema.opportunities).values({ company: "L'Oréal", title: "Director of Design", sourceUrl: "https://jobs.example.com/a", fingerprint: old });
    await save(ctx(), [find({ url: "https://jobs.example.com/b", company: "L'Oréal", location: "Montréal, QC" })], "agent");
    const opps = await db.select().from(schema.opportunities);
    expect(opps.map((o) => [o.fingerprint, o.sourceUrl])).toEqual([[old, "https://jobs.example.com/a"]]);
  });

  it("merges 'Acme, Inc.' and 'Acme' as one job (#1645)", async () => {
    await save(ctx(), [find({ url: "https://jobs.example.com/a", company: "Acme, Inc." })], "agent");
    const t = await save(ctx(), [find({ url: "https://jobs.example.com/b", company: "Acme" })], "agent");
    expect(t.added).toBe(0);
    expect(await db.select().from(schema.opportunities)).toHaveLength(1);
  });

  it("matches a posting stored under the key from before #1645, not a second row", async () => {
    const old = suffixedFingerprint("Acme, Inc.", "Director of Design", "New York, NY");
    await db.insert(schema.opportunities).values({ company: "Acme, Inc.", title: "Director of Design", sourceUrl: "https://jobs.example.com/a", fingerprint: old });
    await save(ctx(), [find({ url: "https://jobs.example.com/b", company: "Acme, Inc.", location: "New York, NY" })], "agent");
    const opps = await db.select().from(schema.opportunities);
    expect(opps.map((o) => [o.fingerprint, o.sourceUrl])).toEqual([[old, "https://jobs.example.com/a"]]);
  });

  it("merges 'Sr. Product Designer' and 'Senior Product Designer' as one job (#1828)", async () => {
    await save(ctx(), [find({ url: "https://www.linkedin.com/jobs/view/4012345678", title: "Sr. Product Designer" })], "agent");
    const t = await save(ctx(), [find({ url: "https://job-boards.greenhouse.io/acme/jobs/123", title: "Senior Product Designer" })], "agent");
    expect(t.added).toBe(0);
    expect(await db.select().from(schema.opportunities)).toHaveLength(1);
  });

  it("matches a posting stored under the key from before #1828, not a second row", async () => {
    const old = unspelledFingerprint("Acme", "Sr. Product Designer", "New York, NY");
    await db.insert(schema.opportunities).values({ company: "Acme", title: "Sr. Product Designer", sourceUrl: "https://jobs.example.com/a", fingerprint: old });
    await save(ctx(), [find({ url: "https://jobs.example.com/b", company: "Acme", title: "Sr. Product Designer", location: "New York, NY" })], "agent");
    const opps = await db.select().from(schema.opportunities);
    expect(opps.map((o) => [o.fingerprint, o.sourceUrl])).toEqual([[old, "https://jobs.example.com/a"]]);
  });

  it("keeps the same job in two countries or states as two finds (#1285)", async () => {
    const pairs = [
      ["Acme", "Remote, US", "Remote, Canada"],
      ["Bolt", "Cambridge, MA", "Cambridge, United Kingdom"],
      ["Cove", "Portland, OR", "Portland, ME"],
    ];
    for (const [company, a, b] of pairs) {
      const at = (loc: string, n: string) => find({ company, url: `https://jobs.example.com/${company}/${n}`, location: loc });
      await save(ctx(), [at(a, "a")], "agent");
      await save(ctx(), [at(b, "b")], "agent");
      // A later read of each lands on its own row.
      await save(ctx(), [at(b, "b2")], "agent");
      await save(ctx(), [at(a, "a2")], "agent");
      const opps = await db.select().from(schema.opportunities).where(eq(schema.opportunities.company, company));
      expect(opps.map((o) => [o.location, o.sourceUrl]).sort()).toEqual(
        [
          [a, `https://jobs.example.com/${company}/a`],
          [b, `https://jobs.example.com/${company}/b`],
        ].sort(),
      );
    }
  });

  it("still merges one city written two ways, and matches a posting stored before #1285", async () => {
    await db.insert(schema.opportunities).values({ company: "Acme", title: "Director of Design", location: "New York, NY", sourceUrl: "https://jobs.example.com/a", fingerprint: fingerprint("Acme", "Director of Design", "New York, NY") });
    await save(ctx(), [find({ url: "https://jobs.example.com/b", location: "New York, New York" })], "agent");
    await save(ctx(), [find({ url: "https://jobs.example.com/c", location: "New York" })], "agent");
    const opps = await db.select().from(schema.opportunities);
    expect(opps.map((o) => o.sourceUrl)).toEqual(["https://jobs.example.com/a"]);
  });

  it("fills a shared posting's link and summary when it has none", async () => {
    await db.insert(schema.opportunities).values({ company: "Acme", title: "Director of Design", fingerprint: fingerprint("Acme", "Director of Design", "New York, NY (hybrid)") });
    await save(ctx(), [find()], "agent");
    const [o] = await db.select().from(schema.opportunities);
    expect(o).toMatchObject({ sourceUrl: "https://jobs.example.com/acme/123", description: "Lead the design team." });
  });
});

describe("loadContext", () => {
  it("returns this search's URLs, the floor, and the 12 newest Not a fit reasons", async () => {
    const [other] = await db.insert(schema.searches).values({ userId, name: "Other", answers: {} }).returning();
    await save(ctx({ searchId: other.id }), [find({ url: "https://jobs.example.com/other", company: "Other Co" })], "agent");
    const finds = Array.from({ length: 14 }, (_, i) => find({ url: `https://jobs.example.com/${i}`, company: `Co ${i}` }));
    await save(ctx(), finds, "agent");
    const rows = await db.select().from(schema.userOpportunities).where(eq(schema.userOpportunities.searchId, searchId));
    const opps = await db.select().from(schema.opportunities);
    for (const row of rows) {
      const i = Number(opps.find((o) => o.id === row.opportunityId)!.company.split(" ")[1]);
      const at = new Date(Date.UTC(2026, 10, 1 + i)).toISOString();
      await db
        .update(schema.userOpportunities)
        .set({ feedback: { reason: `reason ${i}`, at } })
        .where(eq(schema.userOpportunities.opportunityId, row.opportunityId));
    }

    const c = await loadContext(searchId);
    expect(c).toMatchObject({ userId, searchId, kind: "job", floor: 180000, hasResume: false });
    expect(c.knownUrls).toHaveLength(14);
    expect(c.knownUrls).not.toContain("https://jobs.example.com/other");
    expect(c.rejected).toHaveLength(12);
    expect(c.rejected[0]).toBe("Director of Design at Co 13: reason 13");
    expect(c.rejected[11]).toBe("Director of Design at Co 2: reason 2");
  });
});

describe("realDate (#1057)", () => {
  it.each(["2026-11-00", "2026-13-01", "2026-00-00", "2026-02-30", "0000-01-01", "2026-1-5", ""])("drops %s instead of failing the run", (d) => {
    expect(realDate(d)).toBeNull();
  });
  it("keeps a real day", () => {
    expect(realDate("2026-11-13")).toBe("2026-11-13");
    expect(realDate(null)).toBeNull();
  });
});

describe("realDate: no posted date in the future (#1718)", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  it("drops a date past tomorrow, such as a deadline read as the posted day", () => {
    expect(realDate("2026-12-15", now)).toBeNull();
    expect(realDate("2099-01-01", now)).toBeNull();
    expect(realDate("2026-11-26", now)).toBeNull();
  });
  it("keeps today and tomorrow, for time zones ahead of the server", () => {
    expect(realDate("2026-11-24", now)).toBe("2026-11-24");
    expect(realDate("2026-11-25", now)).toBe("2026-11-25");
  });
  it("keeps the day of a timestamp", () => {
    expect(realDate("2026-11-20T10:00:00Z", now)).toBe("2026-11-20");
    expect(realDate("2026-11-20T10:00:00.000+05:30", now)).toBe("2026-11-20");
    expect(realDate("2026-11-20 10:00", now)).toBe("2026-11-20");
  });
  it("still drops other text", () => {
    expect(realDate("2026-11-20 or so", now)).toBeNull();
    expect(realDate("2026-11-30T10:00:00Z", now)).toBeNull();
  });
});

describe("save: a board job at another link for the same ATS job (#1146)", () => {
  const saved = "https://job-boards.greenhouse.io/acme/jobs/4012345";
  it("agent: the old Greenhouse host with a reworded title is known", async () => {
    await save(ctx(), [find({ url: saved })], "agent");
    const r = await save(ctx({ knownUrls: [saved] }), [find({ url: "https://boards.greenhouse.io/acme/jobs/4012345", title: "Design Director" })], "agent");
    expect(r).toMatchObject({ postings: 1, known: 1, added: 0 });
    expect(await board()).toHaveLength(1);
  });
  it("agent: the company page's ?gh_jid= link is known", async () => {
    await save(ctx(), [find({ url: saved })], "agent");
    const r = await save(ctx({ knownUrls: [saved] }), [find({ url: "https://acme.com/careers/job?gh_jid=4012345", title: "Director, Design", location: "New York City" })], "agent");
    expect(r).toMatchObject({ known: 1, added: 0 });
    expect(await board()).toHaveLength(1);
  });
  it("agent: the same ATS job twice in one run is added once, and not as already on the board (#1531)", async () => {
    const r = await save(ctx(), [find({ url: saved }), find({ url: "https://boards.greenhouse.io/acme/jobs/4012345", title: "Design Director" })], "agent");
    expect(r).toMatchObject({ added: 1, known: 0 });
    expect(await board()).toHaveLength(1);
  });
});
