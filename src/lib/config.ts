import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { decrypt, encrypt, mask } from "@/lib/secrets";

/**
 * Runtime config an admin edits in the app. Env vars are the defaults; values
 * saved from the admin page win. API keys are stored encrypted.
 */
export const AiConfigSchema = z.object({
  /** "agent" = searches are queued for an external agent (e.g. Claude Code on Eric's Mac) via /api/agent */
  provider: z.enum(["openai", "anthropic", "agent"]),
  /** OpenAI-compatible endpoint: OpenRouter, DeepInfra, Together, Groq, Fireworks, Ollama, vLLM... */
  baseUrl: z.string().url().max(300),
  model: z.string().max(200),
  apiKey: z.string().max(500),
  /** USD per million tokens, for cost tracking and budgets */
  priceIn: z.number().min(0).max(1000),
  priceOut: z.number().min(0).max(1000),
  /** Some providers reject json_schema; fall back to plain JSON mode */
  jsonMode: z.enum(["schema", "object"]),
  /**
   * OpenRouter only. "strict" routes to hosts that keep nothing and don't train on prompts
   * (zero data retention), trying US hosts first. Resumes go through here, so strict is the default.
   */
  privacy: z.enum(["strict", "standard"]).default("strict"),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;

export const SearchConfigSchema = z.object({
  provider: z.enum(["searxng", "brave", "none"]),
  searxngUrl: z.string().url().max(300),
  braveKey: z.string().max(200),
  pricePerQuery: z.number().min(0).max(1),
});
export type SearchConfig = z.infer<typeof SearchConfigSchema>;

export const AccessConfigSchema = z.object({
  signupMode: z.enum(["open", "invite"]),
  dailyBudgetUsd: z.number().min(0).max(10000),
  userDailyBudgetUsd: z.number().min(0).max(1000),
});
export type AccessConfig = z.infer<typeof AccessConfigSchema>;

const SECRET_FIELDS: Record<string, string[]> = { ai: ["apiKey"], search: ["braveKey"], access: [] };

function defaults() {
  return {
    ai: {
      provider: (["anthropic", "agent"].includes(process.env.AI_PROVIDER ?? "") ? process.env.AI_PROVIDER : "openai") as AiConfig["provider"],
      baseUrl: process.env.AI_BASE_URL || "https://openrouter.ai/api/v1",
      model: process.env.AI_MODEL || "",
      apiKey: process.env.AI_API_KEY || (process.env.AI_PROVIDER === "anthropic" ? process.env.ANTHROPIC_API_KEY || "" : ""),
      priceIn: Number(process.env.AI_PRICE_IN || "0.5"),
      priceOut: Number(process.env.AI_PRICE_OUT || "1.5"),
      jsonMode: (process.env.AI_JSON_MODE === "object" ? "object" : "schema") as AiConfig["jsonMode"],
      privacy: "strict" as AiConfig["privacy"],
    } satisfies AiConfig,
    search: {
      provider: (process.env.SEARCH_PROVIDER as SearchConfig["provider"]) || "searxng",
      searxngUrl: process.env.SEARXNG_URL || "http://searxng:8080",
      braveKey: process.env.BRAVE_API_KEY || "",
      pricePerQuery: Number(process.env.SEARCH_PRICE || "0"),
    } satisfies SearchConfig,
    access: {
      signupMode: env.signupMode,
      dailyBudgetUsd: env.dailyBudgetUsd,
      userDailyBudgetUsd: env.userDailyBudgetUsd,
    } satisfies AccessConfig,
  };
}

type Sections = ReturnType<typeof defaults>;
type Name = keyof Sections;

async function load<N extends Name>(name: N): Promise<Sections[N]> {
  const base = defaults()[name];
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, name));
  if (!row) return base;
  const saved = { ...row.value };
  for (const f of SECRET_FIELDS[name]) {
    if (typeof saved[f] === "string" && saved[f]) {
      try {
        saved[f] = decrypt(saved[f] as string);
      } catch {
        delete saved[f];
      }
    }
  }
  return { ...base, ...saved } as Sections[N];
}

export const getAiConfig = () => load("ai");
export const getSearchConfig = () => load("search");
export const getAccessConfig = () => load("access");

/** Save a section. Empty secret fields keep the stored value, so the admin page never needs to see the key. */
export async function saveConfig<N extends Name>(name: N, value: Sections[N]) {
  const current = await load(name);
  const out: Record<string, unknown> = { ...value };
  for (const f of SECRET_FIELDS[name]) {
    const v = out[f] as string;
    const keep = !v ? (current as Record<string, unknown>)[f] : v;
    out[f] = keep ? encrypt(keep as string) : "";
  }
  await db
    .insert(schema.appSettings)
    .values({ key: name, value: out })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: out, updatedAt: new Date() } });
}

/** Config as the admin page sees it: secrets masked. */
export async function publicConfig() {
  const [ai, search, access] = await Promise.all([getAiConfig(), getSearchConfig(), getAccessConfig()]);
  const [seen] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "agent_seen"));
  return {
    agent: { tokenSet: (process.env.AGENT_TOKEN ?? "").length >= 32, lastSeen: (seen?.value?.at as string | undefined) ?? null },
    ai: { ...ai, apiKey: "", apiKeyHint: mask(ai.apiKey) },
    search: { ...search, braveKey: "", braveKeyHint: mask(search.braveKey) },
    access,
  };
}
