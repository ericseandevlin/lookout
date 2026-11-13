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

const { loadContext, save } = await import("./discover");
const { fingerprint } = await import("./rules");
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

  it("on a search, skips URLs already on the board, ignoring tracking params and www", async () => {
    const r = await save(ctx({ knownUrls: ["https://www.jobs.example.com/acme/123/?utm_source=x"] }), [find()], "agent");
    expect(r).toMatchObject({ postings: 1, known: 1, added: 0 });
    expect(await board()).toHaveLength(0);
  });

  it("counts the same URL twice in one search once", async () => {
    const r = await save(ctx(), [find(), find({ title: "Director, Design" })], "agent");
    expect(r).toMatchObject({ added: 1, known: 1 });
  });

  it("counts the same posting at a different URL as known when it is already on the board", async () => {
    await save(ctx(), [find()], "agent");
    const r = await save(ctx(), [find({ url: "https://boards.example.org/acme-director" })], "agent");
    expect(r).toMatchObject({ added: 0, known: 1 });
    expect(await board()).toHaveLength(1);
  });

  it("drops dealbreakers on a search but keeps them when the person adds the link", async () => {
    expect(await save(ctx(), [find({ dealbreaker: true })], "agent")).toMatchObject({ dealbreaker: 1, added: 0 });
    const manual = await save(ctx({ knownUrls: ["https://jobs.example.com/acme/123"] }), [find({ dealbreaker: true })], "manual");
    expect(manual).toMatchObject({ dealbreaker: 0, added: 1, known: 0 });
    expect((await board())[0].via).toBe("manual");
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
