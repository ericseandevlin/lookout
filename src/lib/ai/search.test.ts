import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyUsage } from "./llm";
import { SearchConfigError, webSearch } from "./search";

const cfg = { provider: "searxng" as const, searxngUrl: "https://search.example.com", braveKey: "", pricePerQuery: 0.01 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

const brave = { ...cfg, provider: "brave" as const, braveKey: "brave-key" };
const ok = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, json: async () => body });

describe("webSearch backends", () => {
  it("asks Brave for 20 recent results with the key header", async () => {
    const fetchMock = ok({ web: { results: [] } });
    vi.stubGlobal("fetch", fetchMock);
    await webSearch("designer jobs", emptyUsage(), brave);
    const [u, init] = fetchMock.mock.calls[0];
    const url = new URL(String(u));
    expect(url.origin + url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(url.searchParams.get("q")).toBe("designer jobs");
    expect(url.searchParams.get("count")).toBe("20");
    expect(url.searchParams.get("freshness")).toBe("pm");
    expect(init.headers["x-subscription-token"]).toBe("brave-key");
  });

  it("drops Brave freshness for older pages", async () => {
    const fetchMock = ok({ web: { results: [] } });
    vi.stubGlobal("fetch", fetchMock);
    await webSearch("Acme recruiter", emptyUsage(), brave, { recent: false });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.has("freshness")).toBe(false);
  });

  it("maps Brave results, strips markup from snippets and keeps only web links", async () => {
    vi.stubGlobal("fetch", ok({ web: { results: [
      { title: "Design Lead", url: "https://jobs.example.com/1", description: "A <strong>design</strong> role", page_age: "2026-11-01" },
      { title: "Bad", url: "javascript:alert(1)" },
      { title: "Ftp", url: "ftp://files.example.com/x" },
      { title: "No url" },
    ] } }));
    expect(await webSearch("q", emptyUsage(), brave)).toEqual([
      { title: "Design Lead", url: "https://jobs.example.com/1", snippet: "A design role", published: "2026-11-01" },
    ]);
  });

  it("maps SearXNG results and keeps only web links", async () => {
    vi.stubGlobal("fetch", ok({ results: [
      { title: "Design Lead", url: "http://jobs.example.com/1", content: "A role", publishedDate: "2026-11-01" },
      { url: "javascript:alert(1)" },
      { url: "https://jobs.example.com/2" },
    ] }));
    expect(await webSearch("q", emptyUsage(), cfg)).toEqual([
      { title: "Design Lead", url: "http://jobs.example.com/1", snippet: "A role", published: "2026-11-01" },
      { title: "", url: "https://jobs.example.com/2", snippet: "", published: undefined },
    ]);
  });

  it("treats a missing result list as no hits", async () => {
    vi.stubGlobal("fetch", ok({}));
    expect(await webSearch("q", emptyUsage(), cfg)).toEqual([]);
    expect(await webSearch("q", emptyUsage(), brave)).toEqual([]);
  });

  it("throws on a failed response from either backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(webSearch("q", emptyUsage(), cfg)).rejects.toThrow("SearXNG 503");
    await expect(webSearch("q", emptyUsage(), brave)).rejects.toThrow("Brave 503");
  });
});

describe("webSearch config errors", () => {
  it("refuses when search is off, without calling out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(webSearch("q", emptyUsage(), { ...cfg, provider: "none" })).rejects.toBeInstanceOf(SearchConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses Brave without a key, without calling out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(webSearch("q", emptyUsage(), { ...brave, braveKey: "" })).rejects.toThrow("Brave Search needs an API key.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("webSearch Brave fallback (#987)", () => {
  const withKey = { ...cfg, braveKey: "brave-key" };
  const hit = { title: "Design Lead", url: "https://jobs.example.com/1", description: "A role" };
  const isBrave = (u: unknown) => String(u).startsWith("https://api.search.brave.com/");

  it("does not call Brave when SearXNG has results", async () => {
    const fetchMock = ok({ results: [{ url: "https://jobs.example.com/1" }] });
    vi.stubGlobal("fetch", fetchMock);
    const onFallback = vi.fn();
    const usage = emptyUsage();
    expect(await webSearch("q", usage, withKey, { onFallback })).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
    expect(usage).toEqual({ input: 0, output: 0, searches: 1, usd: 0.01 });
  });

  it("asks Brave when SearXNG comes back empty, and counts and prices the extra query", async () => {
    const fetchMock = vi.fn(async (u: unknown) => ({ ok: true, json: async () => (isBrave(u) ? { web: { results: [hit] } } : { results: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
    const onFallback = vi.fn();
    const usage = emptyUsage();
    expect(await webSearch("designer jobs", usage, withKey, { onFallback })).toEqual([{ title: "Design Lead", url: "https://jobs.example.com/1", snippet: "A role", published: undefined }]);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("q")).toBe("designer jobs");
    expect(usage.searches).toBe(2);
    expect(usage.usd).toBeCloseTo(0.015);
  });

  it("asks Brave when SearXNG fails, with the same freshness", async () => {
    const fetchMock = vi.fn(async (u: unknown) => (isBrave(u) ? { ok: true, json: async () => ({ web: { results: [hit] } }) } : { ok: false, status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await webSearch("q", emptyUsage(), withKey, { recent: false })).toHaveLength(1);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.has("freshness")).toBe(false);
  });

  it("asks Brave when SearXNG times out or can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: unknown) => {
      if (!isBrave(u)) throw new TypeError("fetch failed");
      return { ok: true, json: async () => ({ web: { results: [hit] } }) };
    }));
    expect(await webSearch("q", emptyUsage(), withKey)).toHaveLength(1);
  });

  it("keeps SearXNG's error when Brave fails too", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: unknown) => ({ ok: false, status: isBrave(u) ? 429 : 503 })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(webSearch("q", emptyUsage(), withKey)).rejects.toThrow("SearXNG 503");
  });

  it("returns no hits when SearXNG was empty and Brave fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: unknown) => (isBrave(u) ? { ok: false, status: 429 } : { ok: true, json: async () => ({ results: [] }) })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await webSearch("q", emptyUsage(), withKey)).toEqual([]);
  });

  it("stays on SearXNG alone without a Brave key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const onFallback = vi.fn();
    await expect(webSearch("q", emptyUsage(), cfg, { onFallback })).rejects.toThrow("SearXNG 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("reads the fallback price from BRAVE_PRICE", async () => {
    vi.stubEnv("BRAVE_PRICE", "0.009");
    vi.stubGlobal("fetch", vi.fn(async (u: unknown) => ({ ok: true, json: async () => (isBrave(u) ? { web: { results: [] } } : { results: [] }) })));
    const usage = emptyUsage();
    await webSearch("q", usage, { ...withKey, pricePerQuery: 0 });
    expect(usage.usd).toBeCloseTo(0.009);
    vi.unstubAllEnvs();
  });
});
