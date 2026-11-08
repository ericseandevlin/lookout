import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { completeJSON, emptyUsage } from "./llm";
import type { AiConfig } from "@/lib/config";

// The Anthropic path (#419): the SDK's structured output over a stubbed fetch, so an SDK upgrade that changes
// the request or the parsing fails here. Each test uses its own key, because the client is cached per key.
const cfgFor = (apiKey: string): AiConfig => ({ provider: "anthropic", baseUrl: "", model: "claude-test", apiKey, priceIn: 3, priceOut: 15, jsonMode: "schema", privacy: "strict" });
const message = (text: string, over: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "claude-test", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text }],
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
      ...over,
    }),
    { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } },
  );
// SDK 0.x sends the key as x-api-key, 1.x as a Bearer token (#185); either is fine.
const keyOf = (h: Headers) => h.get("x-api-key") ?? h.get("authorization")?.replace(/^Bearer /, "") ?? null;
const sent = (f: ReturnType<typeof vi.fn>, i = 0) => {
  const [url, init] = f.mock.calls[i] as [string | URL | Request, RequestInit];
  return { url: String(url instanceof Request ? url.url : url), body: JSON.parse(String(init.body)), headers: new Headers(init.headers) };
};

describe("completeJSON (Anthropic)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const schema = z.object({ title: z.string(), score: z.number() });

  it("sends the schema as structured output, returns the parsed value and charges cache reads as input", async () => {
    const f = vi.fn().mockResolvedValue(message('{"title":"Director of Events","score":5}'));
    vi.stubGlobal("fetch", f);
    const usage = emptyUsage();
    const out = await completeJSON({ name: "t", schema, system: "sys", user: "the posting", maxTokens: 900, usage, cfg: cfgFor("k-parse") });
    expect(out).toEqual({ title: "Director of Events", score: 5 });

    const { url, body, headers } = sent(f);
    expect(url).toMatch(/\/v1\/messages(\?|$)/);
    expect(keyOf(headers)).toBe("k-parse");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body).toMatchObject({ model: "claude-test", max_tokens: 900, system: "sys", messages: [{ role: "user", content: "the posting" }] });
    expect(body.output_config.effort).toBe("low");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.properties).toHaveProperty("title");
    expect(body.output_config.format.schema.properties).toHaveProperty("score");

    expect(usage.input).toBe(1500);
    expect(usage.output).toBe(200);
    expect(usage.usd).toBeCloseTo((1500 * 3 + 200 * 15) / 1e6);
  });

  it("asks for 8000 tokens when the caller doesn't say", async () => {
    const f = vi.fn().mockResolvedValue(message('{"title":"x","score":1}'));
    vi.stubGlobal("fetch", f);
    await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: cfgFor("k-default") });
    expect(sent(f).body.max_tokens).toBe(8000);
  });

  it("throws on a refusal with no output, and charges for it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(message("", { stop_reason: "refusal", content: [] })));
    const usage = emptyUsage();
    await expect(completeJSON({ name: "score", schema, system: "s", user: "u", usage, cfg: cfgFor("k-refuse") })).rejects.toThrow("score: no usable output");
    expect(usage.output).toBe(200);
  });

  it("throws on a refusal in prose; the SDK fails to parse it before usage is charged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(message("I can't help with that.", { stop_reason: "refusal" })));
    const usage = emptyUsage();
    await expect(completeJSON({ name: "score", schema, system: "s", user: "u", usage, cfg: cfgFor("k-refuse-prose") })).rejects.toThrow();
    // Known gap: this call's tokens don't reach the spend caps. Pinned so an SDK change here shows up.
    expect(usage.output).toBe(0);
  });

  it("throws when the reply doesn't match the schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(message('{"title":"x"}')));
    await expect(completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: cfgFor("k-bad") })).rejects.toThrow();
  });

  it("reuses the client for the same key and makes a new one when the key changes", async () => {
    const first = vi.fn().mockImplementation(async () => message('{"title":"a","score":1}'));
    vi.stubGlobal("fetch", first);
    await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: cfgFor("k-reuse") });

    // The SDK keeps the fetch it was built with, so a reused client keeps calling the first stub.
    const second = vi.fn().mockImplementation(async () => message('{"title":"b","score":2}'));
    vi.stubGlobal("fetch", second);
    expect(await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: cfgFor("k-reuse") })).toEqual({ title: "a", score: 1 });
    expect(await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: cfgFor("k-rotated") })).toEqual({ title: "b", score: 2 });
    expect(keyOf(sent(second).headers)).toBe("k-rotated");
  });
});
