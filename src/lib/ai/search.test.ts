import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyUsage } from "./llm";
import { webSearch } from "./search";

const cfg = { provider: "searxng" as const, searxngUrl: "https://search.example.com", braveKey: "", pricePerQuery: 0.01 };

afterEach(() => vi.unstubAllGlobals());

describe("webSearch freshness", () => {
  it("keeps job discovery limited to the past month by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    await webSearch("designer jobs", emptyUsage(), cfg);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("time_range")).toBe("month");
  });

  it("lets public people searches include older pages", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const usage = emptyUsage();
    await webSearch("Acme recruiter", usage, cfg, { recent: false });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.has("time_range")).toBe(false);
    expect(usage).toEqual({ input: 0, output: 0, searches: 1, usd: 0.01 });
  });
});
