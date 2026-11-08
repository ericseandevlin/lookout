import { describe, expect, it } from "vitest";
import { extractJson } from "./llm";

describe("extractJson", () => {
  it("reads plain JSON", () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }));
  it("strips code fences and prose", () => expect(extractJson('Sure!\n```json\n{"a":[1,2]}\n```\nDone.')).toEqual({ a: [1, 2] }));
  it("drops reasoning blocks", () => expect(extractJson('<think>{"no":true}</think>{"ok":true}')).toEqual({ ok: true }));
  it("throws on non-JSON", () => expect(() => extractJson("no json here")).toThrow());
});

import { afterEach, vi } from "vitest";
import { z } from "zod";
import { AiConfigError, completeJSON, emptyUsage, testModel } from "./llm";
import type { AiConfig } from "@/lib/config";

const cfg: AiConfig = { provider: "openai", baseUrl: "https://llm.example/v1", model: "m", apiKey: "k", priceIn: 1, priceOut: 2, jsonMode: "schema", privacy: "strict" };
const reply = (content: string, status = 200) =>
  new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }) : "unsupported response_format", { status });

describe("completeJSON (OpenAI-compatible)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const schema = z.object({ ok: z.boolean() });

  it("parses, validates and charges usage", async () => {
    const f = vi.fn().mockResolvedValue(reply('{"ok":true}'));
    vi.stubGlobal("fetch", f);
    const usage = emptyUsage();
    expect(await completeJSON({ name: "t", schema, system: "s", user: "u", usage, cfg })).toEqual({ ok: true });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.response_format.type).toBe("json_schema");
    expect(f.mock.calls[0][1].headers.authorization).toBe("Bearer k");
    expect(usage.usd).toBeCloseTo((1000 * 1 + 500 * 2) / 1e6);
  });

  it("sends zero-retention routing to OpenRouter only, unless privacy is standard", async () => {
    const f = vi.fn().mockImplementation(async () => reply('{"ok":true}'));
    vi.stubGlobal("fetch", f);
    const or = { ...cfg, baseUrl: "https://openrouter.ai/api/v1" };
    await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: or });
    await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg });
    await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: { ...or, privacy: "standard" } });
    const bodies = f.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies[0].provider).toMatchObject({ data_collection: "deny", zdr: true });
    expect(bodies[1].provider).toBeUndefined();
    expect(bodies[2].provider).toBeUndefined();
  });

  it("explains when no zero-retention host serves the model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("No endpoints found matching your data policy", { status: 404 })));
    await expect(
      completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: { ...cfg, baseUrl: "https://openrouter.ai/api/v1" } }),
    ).rejects.toThrow(/zero-retention/);
  });

  it("falls back to plain JSON mode when the provider rejects json_schema", async () => {
    const f = vi.fn().mockResolvedValueOnce(reply("", 400)).mockResolvedValueOnce(reply('{"ok":false}'));
    vi.stubGlobal("fetch", f);
    expect(await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg })).toEqual({ ok: false });
    expect(JSON.parse(f.mock.calls[1][1].body).response_format.type).toBe("json_object");
  });

  it("asks again when the JSON doesn't match the schema", async () => {
    const f = vi.fn().mockResolvedValueOnce(reply('{"ok":"yes"}')).mockResolvedValueOnce(reply('{"ok":true}'));
    vi.stubGlobal("fetch", f);
    expect(await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg })).toEqual({ ok: true });
    const msgs = JSON.parse(f.mock.calls[1][1].body).messages;
    expect(msgs.at(-1).content).toMatch(/didn't match the schema/);
  });

  it("turns the model's thinking off on OpenRouter only (#188)", async () => {
    const f = vi.fn().mockImplementation(async () => reply('{"ok":true}'));
    vi.stubGlobal("fetch", f);
    await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: { ...cfg, baseUrl: "https://openrouter.ai/api/v1" } });
    await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg });
    expect(JSON.parse(f.mock.calls[0][1].body).reasoning).toEqual({ enabled: false });
    expect(JSON.parse(f.mock.calls[1][1].body).reasoning).toBeUndefined();
  });

  it("retries a cut-off reply with more room, and says so if it stays cut off (#188)", async () => {
    const cut = () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"ok":tr' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    const f = vi.fn().mockResolvedValueOnce(cut()).mockResolvedValueOnce(reply('{"ok":true}'));
    vi.stubGlobal("fetch", f);
    expect(await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg, maxTokens: 1000 })).toEqual({ ok: true });
    expect(JSON.parse(f.mock.calls[1][1].body).max_tokens).toBe(2000);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => cut()));
    await expect(completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg, maxTokens: 1000 })).rejects.toThrow(/cut off at 8000 tokens/);
  });

  it("refuses to run without a model", async () => {
    await expect(completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: { ...cfg, model: "" } })).rejects.toThrow(/No AI model/);
  });

  it("refuses in Claude agent mode, which has no model API (#478)", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: { ...cfg, provider: "agent" } })).rejects.toThrow(AiConfigError);
    expect(f).not.toHaveBeenCalled();
  });

  it("needs an API key for a remote host, but not for a local one (#478)", async () => {
    const f = vi.fn().mockImplementation(async () => reply('{"ok":true}'));
    vi.stubGlobal("fetch", f);
    await expect(completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: { ...cfg, apiKey: "" } })).rejects.toThrow(/No AI API key/);
    expect(f).not.toHaveBeenCalled();
    for (const baseUrl of ["http://localhost:11434/v1", "http://host.docker.internal:11434/v1", "http://ollama:11434/v1"]) {
      expect(await completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: { ...cfg, apiKey: "", baseUrl } })).toEqual({ ok: true });
    }
    expect(f).toHaveBeenCalledTimes(3);
    expect(f.mock.calls[0][1].headers.authorization).toBeUndefined();
  });
});

describe("testModel (Admin > AI settings, Test)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the sample answer, timing and usage (#478)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply('{"ok":true,"city":"Paris"}')));
    const out = await testModel(cfg);
    expect(out).toMatchObject({ ok: true, sample: "Paris" });
    expect(out.ms).toBeGreaterThanOrEqual(0);
    expect(out.usage.usd).toBeCloseTo((1000 * 1 + 500 * 2) / 1e6);
  });

  it("passes a model API error through to the admin (#478)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad key", { status: 401 })));
    await expect(testModel(cfg)).rejects.toThrow(/ping: model API 401: bad key/);
  });
});
