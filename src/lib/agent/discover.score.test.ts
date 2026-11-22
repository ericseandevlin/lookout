import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// scorePages only talks to the model; the database is never reached.
vi.mock("@/lib/db", async () => ({ db: {}, schema: await import("@/lib/db/schema") }));
const completeJSON = vi.fn();
vi.mock("@/lib/ai/llm", () => ({ completeJSON, emptyUsage: () => ({}) }));

const { scorePages, unscoredCount } = await import("./discover");
type Ctx = Parameters<typeof scorePages>[0];

const ctx = { brief: "Design leader", searchProfile: null, resume: "", linkedin: "", links: [], rejected: [] } as unknown as Ctx;
const page = (n: number) => ({ url: `https://jobs.example.com/${n}`, text: `Posting ${n}`, pay: null });
const find = (index: number) => ({ index, is_open_job_posting: true, company: "Acme", title: `Role ${index}`, comp_min: null, comp_max: null });

describe("scorePages (#920)", () => {
  beforeEach(() => {
    completeJSON.mockReset();
  });

  it("skips one failed batch and keeps the others", async () => {
    completeJSON.mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce({ finds: [find(0)] });
    const out = await scorePages(ctx, [1, 2, 3, 4, 5].map(page), {} as never);
    expect(out.map((f) => f.url)).toEqual(["https://jobs.example.com/5"]);
  });

  it("fails the run when every batch fails, instead of reporting no matches", async () => {
    completeJSON.mockRejectedValue(new Error("overloaded"));
    await expect(scorePages(ctx, [1, 2, 3, 4, 5].map(page), {} as never)).rejects.toThrow("score any of them");
  });

  it("reads no pages without calling the model or failing", async () => {
    await expect(scorePages(ctx, [], {} as never)).resolves.toEqual([]);
    expect(completeJSON).not.toHaveBeenCalled();
  });
});

describe("scorePages: today's date (#1388)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("tells the scorer the app's local date, not UTC's", async () => {
    vi.stubEnv("APP_TZ", "America/New_York");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T02:00:00Z")); // 9pm on Nov 18 in New York
    completeJSON.mockReset().mockResolvedValue({ finds: [] });
    await scorePages(ctx, [page(1)], {} as never);
    expect(completeJSON.mock.calls[0][0].system).toContain("Today is 2026-11-18.");
  });
});

describe("unscoredCount (#1456)", () => {
  beforeEach(() => {
    completeJSON.mockReset();
  });

  it("counts the pages a failed batch dropped", async () => {
    const pages = [1, 2, 3, 4, 5].map(page);
    completeJSON.mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce({ finds: [find(0)] });
    expect(unscoredCount(pages, await scorePages(ctx, pages, {} as never))).toBe(4);
  });

  it("counts a page the model gave no entry, and not a page it called no posting", async () => {
    const pages = [1, 2, 3].map(page);
    completeJSON.mockResolvedValueOnce({ finds: [find(0), { ...find(2), is_open_job_posting: false }] });
    expect(unscoredCount(pages, await scorePages(ctx, pages, {} as never))).toBe(1);
  });

  it("is zero when every page was scored", () => {
    expect(unscoredCount([page(1)], [{ url: page(1).url }])).toBe(0);
  });
});

describe("scoring reads the resume (#1531)", () => {
  beforeEach(() => completeJSON.mockReset());
  it("sends the resume along with the search profile, and asks not to contradict it", async () => {
    completeJSON.mockResolvedValue({ finds: [] });
    const sp = { summary: "You design web products.", targetTitles: ["Product Designer"], seniority: "Senior", industries: [], strengths: ["web"], proof: [], where: "Remote", pay: "", avoid: [], searchTerms: [] };
    const withProfile = { ...ctx, searchProfile: sp, resume: "Shipped an iOS and Android app with 1.2 million users" } as unknown as Ctx;
    await scorePages(withProfile, [page(1)], {} as never);
    const call = completeJSON.mock.calls[0][0];
    expect(call.user).toContain("<search_profile>");
    expect(call.user).toContain("<resume>\nShipped an iOS and Android app with 1.2 million users\n</resume>");
    expect(call.system).toContain("Never claim a gap the resume contradicts");
    expect(call.system).toContain("No em dashes");
  });
});
