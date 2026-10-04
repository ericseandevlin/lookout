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
import { completeJSON, emptyUsage } from "./llm";
import type { AiConfig } from "@/lib/config";

const cfg: AiConfig = { provider: "openai", baseUrl: "https://llm.example/v1", model: "m", apiKey: "k", priceIn: 1, priceOut: 2, jsonMode: "schema" };
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

  it("refuses to run without a model", async () => {
    await expect(completeJSON({ name: "t", schema, system: "s", user: "u", usage: emptyUsage(), cfg: { ...cfg, model: "" } })).rejects.toThrow(/No AI model/);
  });
});
