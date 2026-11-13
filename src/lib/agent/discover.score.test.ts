import { beforeEach, describe, expect, it, vi } from "vitest";

// scorePages only talks to the model; the database is never reached.
vi.mock("@/lib/db", async () => ({ db: {}, schema: await import("@/lib/db/schema") }));
const completeJSON = vi.fn();
vi.mock("@/lib/ai/llm", () => ({ completeJSON, emptyUsage: () => ({}) }));

const { scorePages } = await import("./discover");
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
