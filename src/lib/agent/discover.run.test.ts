import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Usage } from "@/lib/ai/llm";
import type { SearchHit } from "@/lib/ai/search";

// A whole discovery run (#379): queries, search, picks, reading, scoring, saving and the run row.
// In-process Postgres with the real migrations; the web, the search backend and the model are stubbed.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

let provider = "openrouter";
vi.mock("@/lib/config", () => ({ getAiConfig: async () => ({ provider, model: "test-model" }) }));
const assertBudget = vi.fn(async () => {});
vi.mock("@/lib/ai/runs", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/runs")>()), assertBudget }));
let searchProfile: schema.SearchProfile | null = null;
vi.mock("./searchProfile", async (orig) => ({ ...(await orig<typeof import("./searchProfile")>()), ensureSearchProfile: async () => ({ profile: searchProfile, rebuilt: false }) }));
const autoQueue = vi.fn(async () => {});
vi.mock("@/lib/apply", () => ({ autoQueue }));
vi.mock("./linkCheck", () => ({ closeGonePostings: async () => 0 }));
vi.mock("./networking", () => ({ findEventsIfDue: async () => null }));
vi.mock("@/lib/features", () => ({ featureOn: () => false }));
const discoverRfp = vi.fn(async () => ({ found: 0, added: 0 }));
vi.mock("./rfp", () => ({ discoverRfp }));

/** Search results by query; a query with no entry fails like a search backend outage. */
const results = new Map<string, SearchHit[]>();
const webSearch = vi.fn(async (q: string) => {
  const r = results.get(q);
  if (!r) throw new Error("Search backend down");
  return r;
});
vi.mock("@/lib/ai/search", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/search")>()), webSearch }));

const pages = new Map<string, string>();
const fetchPage = vi.fn(async (url: string) => {
  const html = pages.get(url);
  if (html === undefined) throw new Error("Page answered 403");
  return { url, html };
});
vi.mock("@/lib/ai/fetchPage", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/fetchPage")>()), fetchPage }));

type Call = { name: string; user: string; usage: Usage };
const replies: Record<string, (c: Call) => unknown> = {};
const completeJSON = vi.fn(async (c: Call) => {
  c.usage.usd += 0.01;
  const reply = replies[c.name];
  if (!reply) throw new Error(`No stub for ${c.name}`);
  return reply(c);
});
vi.mock("@/lib/ai/llm", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/llm")>()), completeJSON }));

const { discover, addByUrl, isRunning } = await import("./discover");
const { FetchError } = await import("@/lib/ai/fetchPage");

/** Per URL, what the scorer says about the page; unlisted pages score as a good open posting. */
const verdicts = new Map<string, Record<string, unknown>>();
const scoreReply = (c: Call) => ({
  finds: [...c.user.matchAll(/^\[(\d+)\] URL: (\S+)/gm)].map(([, i, url]) => ({
    index: Number(i),
    is_open_job_posting: true,
    company: `Co ${url.split("/").pop()}`,
    title: "Design Systems Lead",
    location: "New York, NY (hybrid)",
    work_mode: "Hybrid",
    comp_min: 200000,
    comp_max: 240000,
    posted_at: "2026-11-01",
    description: "Lead the design system.",
    score: 5,
    reasons_match: ["You built one for 40 teams"],
    reasons_gap: [],
    location_fit: true,
    dealbreaker: false,
    ...verdicts.get(url),
  })),
});

const posting = (body = "") => `<html><body><h1>Design Systems Lead</h1><p>${"Own the component library and its tokens. ".repeat(12)}</p>${body}</body></html>`;
const hit = (url: string): SearchHit => ({ title: url, url, snippet: "Open role" });

let userId = "";
let searchId = "";
const runRow = async () => (await db.select().from(schema.runs).where(eq(schema.runs.searchId, searchId)))[0];
const board = () =>
  db
    .select({ url: schema.opportunities.sourceUrl, company: schema.opportunities.company, compMin: schema.opportunities.compMin, via: schema.userOpportunities.addedVia })
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(eq(schema.userOpportunities.searchId, searchId));

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
  provider = "openrouter";
  searchProfile = null;
  results.clear();
  pages.clear();
  verdicts.clear();
  for (const k of Object.keys(replies)) delete replies[k];
  replies.queries = () => ({ queries: ["design systems lead", "design systems lead site:greenhouse.io"] });
  replies.score = scoreReply;
  for (const m of [webSearch, fetchPage, completeJSON, autoQueue, discoverRfp]) m.mockClear();
  assertBudget.mockReset();
  assertBudget.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("discover (#379)", () => {
  it("searches, dedupes, reads, scores and saves, then closes the run with a report", async () => {
    // Already on the board: found again, skipped before reading.
    const [old] = await db.insert(schema.opportunities).values({ company: "Old Co", title: "Lead", fingerprint: "old", sourceUrl: "https://jobs.example.com/old" }).returning();
    await db.insert(schema.userOpportunities).values({ userId, searchId, opportunityId: old.id, score: 4, addedVia: "agent" });
    results.set("design systems lead", [hit("https://jobs.example.com/a"), hit("https://www.linkedin.com/jobs/search?q=x"), hit("https://jobs.example.com/old?utm_source=x")]);
    results.set("design systems lead site:greenhouse.io", [hit("https://jobs.example.com/a"), hit("https://jobs.example.com/b"), hit("https://jobs.example.com/c"), hit("https://jobs.example.com/d")]);
    pages.set("https://jobs.example.com/a", posting());
    pages.set("https://jobs.example.com/b", posting());
    pages.set("https://jobs.example.com/c", "<p>Too short to be a posting</p>");
    // d won't load.
    verdicts.set("https://jobs.example.com/b", { is_open_job_posting: false });

    const r = await discover(searchId, "manual");

    expect(r).toMatchObject({ found: 1, added: 1, runId: expect.any(String) });
    // The aggregator list page and the URL already on the board are never read.
    expect(fetchPage.mock.calls.map((c) => c[0]).sort()).toEqual(["https://jobs.example.com/a", "https://jobs.example.com/b", "https://jobs.example.com/c", "https://jobs.example.com/d"]);
    expect((await board()).map((f) => f.url).sort()).toEqual(["https://jobs.example.com/a", "https://jobs.example.com/old"]);
    expect(autoQueue).toHaveBeenCalledWith(userId, [{ id: expect.any(String), score: 5 }]);

    const run = await runRow();
    expect(run).toMatchObject({ trigger: "manual", status: "done", found: 1, added: 1, error: null });
    expect(run.progress).toMatchObject({ pct: 100, step: "Added 1 new find" });
    expect(run.report).toMatchObject({ queries: ["design systems lead", "design systems lead site:greenhouse.io"], results: 4, picked: 4, read: 2 });
    expect(run.report?.tally).toMatchObject({ postings: 1, notPostings: 1, added: 1 });
    // queries + one scoring batch
    expect(Number(run.costUsd)).toBeCloseTo(0.02);
  });

  it("skips a known posting found under another URL for the same job, and reads one job once (#670)", async () => {
    // Saved under the address Greenhouse redirected to; search returns the old one.
    const [old] = await db.insert(schema.opportunities).values({ company: "Acme", title: "Lead", fingerprint: "acme", sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/123" }).returning();
    await db.insert(schema.userOpportunities).values({ userId, searchId, opportunityId: old.id, score: 4, addedVia: "agent" });
    results.set("design systems lead", [hit("https://boards.greenhouse.io/acme/jobs/123?gh_src=x"), hit("https://jobs.lever.co/beta/0f4c3a2e-1b2c-4d5e-8f90-123456789abc")]);
    results.set("design systems lead site:greenhouse.io", [hit("https://jobs.lever.co/beta/0f4c3a2e-1b2c-4d5e-8f90-123456789abc/apply"), hit("https://jobs.example.com/a?id=1"), hit("https://jobs.example.com/a?id=2")]);
    for (const u of ["https://jobs.lever.co/beta/0f4c3a2e-1b2c-4d5e-8f90-123456789abc", "https://jobs.example.com/a?id=1", "https://jobs.example.com/a?id=2"]) pages.set(u, posting());

    await discover(searchId);

    // Other sites still match on the exact URL, so the two example.com jobs are both read.
    expect(fetchPage.mock.calls.map((c) => c[0]).sort()).toEqual(["https://jobs.example.com/a?id=1", "https://jobs.example.com/a?id=2", "https://jobs.lever.co/beta/0f4c3a2e-1b2c-4d5e-8f90-123456789abc"]);
  });

  it("fills pay from the page when the model misses it", async () => {
    results.set("design systems lead", [hit("https://jobs.example.com/a")]);
    results.set("design systems lead site:greenhouse.io", []);
    pages.set("https://jobs.example.com/a", posting("<p>Base salary: $190,000 to $230,000 per year.</p>"));
    verdicts.set("https://jobs.example.com/a", { comp_min: null, comp_max: null });
    await discover(searchId);
    expect((await board())[0].compMin).toBe(190000);
  });

  it("takes the page's full range when the model reads only one end, so the find isn't cut as below the floor (#851)", async () => {
    results.set("design systems lead", [hit("https://jobs.example.com/a")]);
    results.set("design systems lead site:greenhouse.io", []);
    pages.set("https://jobs.example.com/a", posting("<p>Base salary: $150,000 to $200,000 per year.</p>"));
    verdicts.set("https://jobs.example.com/a", { comp_min: 150000, comp_max: null });
    await discover(searchId);
    const rows = await db.select({ min: schema.opportunities.compMin, max: schema.opportunities.compMax }).from(schema.opportunities);
    expect(rows).toEqual([{ min: 150000, max: 200000 }]);
  });

  it("says a posting under the floor was left off, not that it is already on the board (#862)", async () => {
    results.set("design systems lead", [hit("https://jobs.example.com/a")]);
    results.set("design systems lead site:greenhouse.io", []);
    pages.set("https://jobs.example.com/a", posting());
    verdicts.set("https://jobs.example.com/a", { comp_min: 120000, comp_max: 150000 });
    await expect(discover(searchId)).resolves.toMatchObject({ found: 1, added: 0 });
    expect((await runRow()).progress).toMatchObject({ step: "No new finds this time: 1 under your pay floor" });
  });

  it("reads an hourly rate from the model as no annual pay, and takes the page's annualized range (#702)", async () => {
    results.set("design systems lead", [hit("https://jobs.example.com/a"), hit("https://jobs.example.com/b")]);
    results.set("design systems lead site:greenhouse.io", []);
    pages.set("https://jobs.example.com/a", posting("<p>Pay: $95 to $110 per hour.</p>"));
    pages.set("https://jobs.example.com/b", posting());
    verdicts.set("https://jobs.example.com/a", { comp_min: 95, comp_max: 110 });
    verdicts.set("https://jobs.example.com/b", { comp_min: 65, comp_max: 85 });
    await discover(searchId);
    const rows = await board();
    expect(rows.find((r) => r.url === "https://jobs.example.com/a")?.compMin).toBe(197600);
    expect(rows.find((r) => r.url === "https://jobs.example.com/b")?.compMin).toBeNull();
    const gaps = await db.select({ score: schema.userOpportunities.score, gap: schema.userOpportunities.reasonsGap }).from(schema.userOpportunities).where(eq(schema.userOpportunities.searchId, searchId));
    expect(gaps.every((g) => !g.gap.some((x) => /below your floor/.test(x)))).toBe(true);
    expect(gaps.map((g) => g.score)).toEqual([5, 5]);
  });

  it("tells the scorer today's date, not the date the server started (#608)", async () => {
    results.set("design systems lead", [hit("https://jobs.example.com/a")]);
    results.set("design systems lead site:greenhouse.io", []);
    pages.set("https://jobs.example.com/a", posting());
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2031-03-14T12:00:00Z"));
      await discover(searchId);
    } finally {
      vi.useRealTimers();
    }
    const score = completeJSON.mock.calls.map((c) => c[0] as Call & { system: string }).find((c) => c.name === "score");
    expect(score?.system).toContain("Today is 2031-03-14.");
  });

  it("counts a page once when the scorer repeats its index (#612)", async () => {
    results.set("design systems lead", [hit("https://jobs.example.com/a")]);
    results.set("design systems lead site:greenhouse.io", []);
    pages.set("https://jobs.example.com/a", posting());
    replies.score = (c) => {
      const [first] = scoreReply(c).finds;
      return { finds: [first, { ...first, is_open_job_posting: false }] };
    };
    await expect(discover(searchId)).resolves.toMatchObject({ found: 1, added: 1 });
    expect((await runRow()).report?.tally).toMatchObject({ postings: 1, notPostings: 0, known: 0, added: 1 });
  });

  it("keeps going when one search fails, and fails the run only when every search does", async () => {
    results.set("design systems lead", [hit("https://jobs.example.com/a")]);
    pages.set("https://jobs.example.com/a", posting());
    await expect(discover(searchId)).resolves.toMatchObject({ added: 1 });

    await db.delete(schema.runs);
    results.clear();
    await expect(discover(searchId)).rejects.toThrow("Search backend down");
    expect(await runRow()).toMatchObject({ status: "failed", error: "Search backend down" });
  });

  it("searches the profile's target titles when the model writes no usable queries (#609)", async () => {
    replies.queries = () => ({ queries: ["  ", ""] });
    searchProfile = { summary: "", targetTitles: ["Design Systems Lead", " "], seniority: "", industries: [], strengths: [], proof: [], where: "", pay: "", avoid: [], searchTerms: [] };
    results.set("Design Systems Lead jobs", [hit("https://jobs.example.com/a")]);
    pages.set("https://jobs.example.com/a", posting());
    await expect(discover(searchId)).resolves.toMatchObject({ added: 1 });
    expect(webSearch.mock.calls.map((c) => c[0])).toEqual(["Design Systems Lead jobs"]);
  });

  it("fails with a plain message when there are no queries and no target titles (#609)", async () => {
    replies.queries = () => ({ queries: [] });
    await expect(discover(searchId)).rejects.toThrow("Couldn't plan any searches from your profile");
    expect(webSearch).not.toHaveBeenCalled();
    expect(await runRow()).toMatchObject({ status: "failed", error: expect.stringContaining("Couldn't plan any searches") });
  });

  it("asks the model to pick when there are more than 15 results, and falls back to the top 15 if that fails", async () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`https://jobs.example.com/p${i}`));
    results.set("design systems lead", many);
    results.set("design systems lead site:greenhouse.io", []);
    replies.picks = () => ({ picks: [3, 3, 7, 99] });
    await discover(searchId);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual(["https://jobs.example.com/p3", "https://jobs.example.com/p7"]);

    fetchPage.mockClear();
    await db.delete(schema.runs);
    replies.picks = () => {
      throw new Error("Bad JSON");
    };
    await discover(searchId);
    expect(fetchPage).toHaveBeenCalledTimes(15);
  });

  it("finishes with no finds when scoring fails, instead of failing the run", async () => {
    results.set("design systems lead", [hit("https://jobs.example.com/a")]);
    results.set("design systems lead site:greenhouse.io", []);
    pages.set("https://jobs.example.com/a", posting());
    replies.score = () => {
      throw new Error("Model timed out");
    };
    await expect(discover(searchId)).resolves.toMatchObject({ found: 0, added: 0 });
    expect(await runRow()).toMatchObject({ status: "done", progress: { step: "No matching open roles this time" } });
  });

  it("queues the run for the search agent instead of calling a model", async () => {
    provider = "agent";
    await expect(discover(searchId)).resolves.toEqual({ found: 0, added: 0, queued: true });
    expect(await runRow()).toMatchObject({ status: "queued", request: { type: "discover", searchId } });
    expect(completeJSON).not.toHaveBeenCalled();
    expect(await isRunning(userId)).toBe(true);
  });

  it("hands RFP searches to the SAM.gov reader", async () => {
    await db.update(schema.searches).set({ kind: "rfp" }).where(eq(schema.searches.id, searchId));
    await discover(searchId, "manual");
    expect(discoverRfp).toHaveBeenCalledWith(searchId, userId, "manual");
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it("refuses to start over the spend cap, without a run row", async () => {
    assertBudget.mockRejectedValue(new Error("Daily AI budget reached"));
    await expect(discover(searchId)).rejects.toThrow("Daily AI budget reached");
    expect(await runRow()).toBeUndefined();
  });

  it("throws for a search that doesn't exist", async () => {
    await expect(discover("00000000-0000-0000-0000-000000000000")).rejects.toThrow("Search not found");
  });
});

describe("addByUrl (#379)", () => {
  const URL_A = "https://jobs.example.com/a";

  it("adds the posting even when the model calls it a dealbreaker", async () => {
    pages.set(URL_A, posting());
    verdicts.set(URL_A, { dealbreaker: true });
    await expect(addByUrl(searchId, URL_A)).resolves.toEqual({ added: 1 });
    expect(await board()).toMatchObject([{ url: URL_A, via: "manual" }]);
    expect(await runRow()).toMatchObject({ trigger: "url", status: "done", found: 1, added: 1, progress: { step: `Added Design Systems Lead at Co a` } });
  });

  it("says so when the posting is already on the board", async () => {
    pages.set(URL_A, posting());
    await addByUrl(searchId, URL_A);
    await db.delete(schema.runs);
    await expect(addByUrl(searchId, URL_A)).resolves.toEqual({ added: 0 });
    expect((await runRow()).progress).toMatchObject({ step: "That posting is already on your board" });
  });

  it("fails the run with a plain reason when the page won't load", async () => {
    await expect(addByUrl(searchId, URL_A)).rejects.toThrow("Couldn't load that page");
    expect(await runRow()).toMatchObject({ status: "failed", error: "Couldn't load that page" });

    await db.delete(schema.runs);
    fetchPage.mockRejectedValueOnce(new FetchError("That address isn't allowed"));
    await expect(addByUrl(searchId, URL_A)).rejects.toThrow("That address isn't allowed");
  });

  it("records an error when the page isn't a posting", async () => {
    pages.set(URL_A, posting());
    replies.score = () => ({ finds: [] });
    await expect(addByUrl(searchId, URL_A)).resolves.toEqual({ added: 0 });
    expect(await runRow()).toMatchObject({ status: "failed", error: "That page didn't look like a job posting" });
  });

  it("records an error, not 'already on your board', when the scorer finds no company or title (#668)", async () => {
    pages.set(URL_A, posting());
    for (const v of [{ company: "" }, { title: "", is_open_job_posting: false }]) {
      await db.delete(schema.runs);
      verdicts.set(URL_A, v);
      await expect(addByUrl(searchId, URL_A)).resolves.toEqual({ added: 0 });
      const run = await runRow();
      expect(run).toMatchObject({ status: "failed", found: 0, error: "That page didn't look like a job posting" });
      expect(run.progress).not.toMatchObject({ step: "That posting is already on your board" });
    }
    expect(await board()).toEqual([]);
  });

  it("says scoring failed, not that the page isn't a posting, when the model call fails (#628)", async () => {
    pages.set(URL_A, posting());
    replies.score = () => {
      throw new Error("Model timed out");
    };
    const msg = "Lookout couldn't score that posting just now. Try adding it again.";
    await expect(addByUrl(searchId, URL_A)).rejects.toThrow(msg);
    expect(await runRow()).toMatchObject({ status: "failed", error: msg });
  });

  it("queues for the search agent when one is set", async () => {
    provider = "agent";
    await expect(addByUrl(searchId, URL_A)).resolves.toEqual({ added: 0, queued: true });
    expect(await runRow()).toMatchObject({ status: "queued", request: { type: "url", url: URL_A } });
  });
});

describe("isRunning (#379)", () => {
  it("is true only while a run is queued or running", async () => {
    expect(await isRunning(userId)).toBe(false);
    const [run] = await db.insert(schema.runs).values({ userId, searchId, trigger: "manual", status: "running" }).returning();
    expect(await isRunning(userId)).toBe(true);
    await db.update(schema.runs).set({ status: "done" }).where(eq(schema.runs.id, run.id));
    expect(await isRunning(userId)).toBe(false);
  });
});
