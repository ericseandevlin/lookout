import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getAiConfig, type AiConfig } from "@/lib/config";

export type Usage = { input: number; output: number; searches: number; usd: number };
export const emptyUsage = (): Usage => ({ input: 0, output: 0, searches: 0, usd: 0 });

export class AiConfigError extends Error {}

function charge(u: Usage, cfg: AiConfig, input: number, output: number) {
  u.input += input;
  u.output += output;
  u.usd += (input * cfg.priceIn + output * cfg.priceOut) / 1e6;
}

/** Pull a JSON value out of model text: drops <think> blocks and code fences. */
export function extractJson(text: string): unknown {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (end >= 0) t = t.slice(0, end + 1);
  return JSON.parse(t);
}

type JsonReq<T extends z.ZodType> = {
  name: string;
  schema: T;
  system: string;
  user: string;
  maxTokens?: number;
  usage: Usage;
  cfg?: AiConfig;
};

/** One structured call to whichever model is configured. Validates with zod and retries once on bad JSON. */
/** OpenRouter routing for user data: zero-retention, no-training hosts only, US hosts first. */
const PRIVATE_ROUTING = { data_collection: "deny", zdr: true, order: ["deepinfra", "together", "fireworks"], allow_fallbacks: true };
const strictRouting = (cfg: { baseUrl: string; privacy?: string }) => /openrouter\.ai/.test(cfg.baseUrl) && cfg.privacy !== "standard";

export async function completeJSON<T extends z.ZodType>(req: JsonReq<T>): Promise<z.infer<T>> {
  const cfg = req.cfg ?? (await getAiConfig());
  if (cfg.provider === "agent") throw new AiConfigError("Searches run through the external agent, not a model API.");
  if (!cfg.model) throw new AiConfigError("No AI model is set. An admin can set one under Admin > AI settings.");
  if (!cfg.apiKey && !/localhost|127\.0\.0\.1|host\.docker\.internal|ollama/.test(cfg.baseUrl) && cfg.provider === "openai")
    throw new AiConfigError("No AI API key is set. An admin can add one under Admin > AI settings.");
  return cfg.provider === "anthropic" ? anthropicJSON(req, cfg) : openaiJSON(req, cfg);
}

let anthropicClient: { key: string; client: Anthropic } | null = null;

async function anthropicJSON<T extends z.ZodType>(req: JsonReq<T>, cfg: AiConfig) {
  if (anthropicClient?.key !== cfg.apiKey) anthropicClient = { key: cfg.apiKey, client: new Anthropic({ apiKey: cfg.apiKey }) };
  const res = await anthropicClient.client.beta.messages.parse({
    model: cfg.model,
    max_tokens: req.maxTokens ?? 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(req.schema) },
    system: req.system,
    messages: [{ role: "user", content: req.user }],
  });
  charge(req.usage, cfg, res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0), res.usage.output_tokens);
  if (res.stop_reason === "refusal" || res.parsed_output == null) throw new Error(`${req.name}: no usable output`);
  return res.parsed_output as z.infer<T>;
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

async function openaiJSON<T extends z.ZodType>(req: JsonReq<T>, cfg: AiConfig) {
  const jsonSchema = z.toJSONSchema(req.schema, { target: "draft-7" }) as Record<string, unknown>;
  const schemaNote = `Reply with JSON only, no prose, matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
  const messages: Msg[] = [
    { role: "system", content: `${req.system}\n\n${schemaNote}` },
    { role: "user", content: req.user },
  ];
  let mode = cfg.jsonMode;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        // Attribution headers some gateways (OpenRouter) use; harmless elsewhere.
        "x-title": "Lookout",
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        max_tokens: req.maxTokens ?? 8000,
        temperature: 0.2,
        response_format:
          mode === "schema"
            ? { type: "json_schema", json_schema: { name: req.name, schema: jsonSchema, strict: false } }
            : { type: "json_object" },
        ...(strictRouting(cfg) && { provider: PRIVATE_ROUTING }),
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      if (strictRouting(cfg) && /no endpoints|no allowed providers/i.test(body)) {
        throw new AiConfigError("No zero-retention host serves this model on OpenRouter. Pick another model, or switch Data privacy to Standard in Admin > AI settings.");
      }
      // Providers without json_schema support say so with a 400/422; drop to plain JSON mode once.
      if ((res.status === 400 || res.status === 422) && mode === "schema") {
        mode = "object";
        continue;
      }
      throw new Error(`${req.name}: model API ${res.status}: ${body}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    charge(req.usage, cfg, data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0);
    const text = data.choices?.[0]?.message?.content ?? "";
    let problem: string;
    try {
      const parsed = req.schema.safeParse(extractJson(text));
      if (parsed.success) return parsed.data;
      problem = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch {
      problem = "the reply was not valid JSON";
    }
    messages.push({ role: "assistant", content: text.slice(0, 20_000) }, { role: "user", content: `That didn't match the schema (${problem}). Reply again with corrected JSON only.` });
  }
  throw new Error(`${req.name}: model did not return valid JSON`);
}

/** Small round trip used by the admin "Test" button. */
export async function testModel(cfg: AiConfig) {
  const usage = emptyUsage();
  const started = Date.now();
  const out = await completeJSON({
    name: "ping",
    cfg,
    usage,
    maxTokens: 300,
    schema: z.object({ ok: z.boolean(), city: z.string() }),
    system: "You answer in JSON.",
    user: 'Return {"ok": true, "city": "<the capital of France>"}.',
  });
  return { ok: out.ok, sample: out.city, ms: Date.now() - started, usage };
}
