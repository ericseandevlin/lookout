import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { completeJSON, emptyUsage } from "./llm";
import { anonId, traceAs, traceFields } from "./trace";
import type { AiConfig } from "@/lib/config";

const cfg: AiConfig = { provider: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "m", apiKey: "k", priceIn: 1, priceOut: 2, jsonMode: "schema", privacy: "strict" } as AiConfig;
const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
const schema = z.object({ ok: z.boolean() });

describe("trace fields (#985)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the step alone when no work is marked", async () => {
    await Promise.resolve();
    expect(traceFields("ping")).toEqual({ trace: { generation_name: "ping" } });
  });

  it("carries the run, the kind of work and a hashed person, never the account id", async () => {
    await (async () => {
      traceAs("search", "user-1", "run-9");
      await Promise.resolve();
      const f = traceFields("score");
      expect(f).toEqual({ user: anonId("user-1"), session_id: "run-9", trace: { trace_id: "run-9", trace_name: "search", generation_name: "score", flow: "search" } });
      expect(JSON.stringify(f)).not.toContain("user-1");
    })();
  });

  it("goes to OpenRouter and to no other host", async () => {
    const f = vi.fn().mockImplementation(async () => reply());
    vi.stubGlobal("fetch", f);
    await completeJSON({ name: "queries", schema, system: "s", user: "u", usage: emptyUsage(), cfg });
    await completeJSON({ name: "queries", schema, system: "s", user: "u", usage: emptyUsage(), cfg: { ...cfg, baseUrl: "https://llm.example/v1" } });
    expect(JSON.parse(f.mock.calls[0][1].body).trace.generation_name).toBe("queries");
    const other = JSON.parse(f.mock.calls[1][1].body);
    expect(other.trace).toBeUndefined();
    expect(other.user).toBeUndefined();
  });
});
