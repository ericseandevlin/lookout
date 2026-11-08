import "server-only";
import { getSearchConfig, type SearchConfig } from "@/lib/config";
import type { Usage } from "./llm";

export type SearchHit = { title: string; url: string; snippet: string; published?: string };

export class SearchConfigError extends Error {}

/** Web search through the configured backend. Job discovery stays recent-first; people pages can opt out. */
export async function webSearch(query: string, usage: Usage, cfg?: SearchConfig, options: { recent?: boolean } = {}): Promise<SearchHit[]> {
  const c = cfg ?? (await getSearchConfig());
  const recent = options.recent ?? true;
  usage.searches += 1;
  usage.usd += c.pricePerQuery;
  if (c.provider === "none") throw new SearchConfigError("Web search is turned off. An admin can set it under Admin > AI settings.");
  if (c.provider === "brave") return brave(query, c, recent);
  return searxng(query, c, recent);
}

async function searxng(q: string, c: SearchConfig, recent: boolean): Promise<SearchHit[]> {
  const u = new URL("/search", c.searxngUrl);
  u.searchParams.set("q", q);
  u.searchParams.set("format", "json");
  u.searchParams.set("language", "en-US");
  if (recent) u.searchParams.set("time_range", "month");
  const res = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`SearXNG ${res.status}`);
  const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string; publishedDate?: string }[] };
  return (data.results ?? [])
    .filter((r) => r.url && /^https?:\/\//.test(r.url))
    .map((r) => ({ title: r.title ?? "", url: r.url!, snippet: r.content ?? "", published: r.publishedDate ?? undefined }));
}

async function brave(q: string, c: SearchConfig, recent: boolean): Promise<SearchHit[]> {
  if (!c.braveKey) throw new SearchConfigError("Brave Search needs an API key.");
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", q);
  u.searchParams.set("count", "20");
  if (recent) u.searchParams.set("freshness", "pm");
  const res = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json", "x-subscription-token": c.braveKey } });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string; page_age?: string }[] } };
  return (data.web?.results ?? [])
    .filter((r) => r.url && /^https?:\/\//.test(r.url))
    .map((r) => ({ title: r.title ?? "", url: r.url!, snippet: (r.description ?? "").replace(/<[^>]+>/g, ""), published: r.page_age }));
}

export async function testSearch(cfg: SearchConfig) {
  const started = Date.now();
  const hits = await webSearch("director of events jobs new york", { input: 0, output: 0, searches: 0, usd: 0 }, cfg);
  return { ok: hits.length > 0, count: hits.length, sample: hits[0]?.url ?? "", ms: Date.now() - started };
}
