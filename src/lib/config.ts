import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { env, envNumber } from "@/lib/env";
import { decrypt, encrypt, mask } from "@/lib/secrets";
import { nextSecret, openSecretFields } from "@/lib/secretFields";

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

/** One-question beta surveys (#5): how many days between questions for one person. */
export const SurveyConfigSchema = z.object({ everyDays: z.number().int().min(1).max(90) });
export type SurveyConfig = z.infer<typeof SurveyConfigSchema>;

const SECRET_FIELDS: Record<string, string[]> = { ai: ["apiKey"], search: ["braveKey"], access: [], survey: [] };

function defaults() {
  return {
    ai: {
      provider: (["anthropic", "agent"].includes(process.env.AI_PROVIDER ?? "") ? process.env.AI_PROVIDER : "openai") as AiConfig["provider"],
      baseUrl: process.env.AI_BASE_URL || "https://openrouter.ai/api/v1",
      model: process.env.AI_MODEL || "",
      apiKey: process.env.AI_API_KEY || (process.env.AI_PROVIDER === "anthropic" ? process.env.ANTHROPIC_API_KEY || "" : ""),
      priceIn: envNumber("AI_PRICE_IN", 0.5),
      priceOut: envNumber("AI_PRICE_OUT", 1.5),
      jsonMode: (process.env.AI_JSON_MODE === "object" ? "object" : "schema") as AiConfig["jsonMode"],
      privacy: "strict" as AiConfig["privacy"],
    } satisfies AiConfig,
    search: {
      provider: (process.env.SEARCH_PROVIDER as SearchConfig["provider"]) || "searxng",
      searxngUrl: process.env.SEARXNG_URL || "http://searxng:8080",
      braveKey: process.env.BRAVE_API_KEY || "",
      pricePerQuery: envNumber("SEARCH_PRICE", 0),
    } satisfies SearchConfig,
    access: {
      signupMode: env.signupMode,
      dailyBudgetUsd: env.dailyBudgetUsd,
      userDailyBudgetUsd: env.userDailyBudgetUsd,
    } satisfies AccessConfig,
    survey: { everyDays: 5 } satisfies SurveyConfig,
  };
}

type Sections = ReturnType<typeof defaults>;
type Name = keyof Sections;

const warned = new Set<string>();

/** A section with its saved secrets decrypted, plus the ones that couldn't be read (#274). */
async function loadWithStatus<N extends Name>(name: N): Promise<{ config: Sections[N]; unreadable: string[] }> {
  const base = defaults()[name];
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, name));
  if (!row) return { config: base, unreadable: [] };
  const { saved, unreadable } = openSecretFields(row.value, SECRET_FIELDS[name], decrypt);
  for (const f of unreadable) {
    if (warned.has(`${name}.${f}`)) continue;
    warned.add(`${name}.${f}`);
    console.warn(`[config] saved ${name}.${f} can't be decrypted (APP_SECRET changed?). Not falling back to the env key. Re-enter it under Admin > AI settings.`);
  }
  return { config: { ...base, ...saved } as Sections[N], unreadable };
}

const load = async <N extends Name>(name: N) => (await loadWithStatus(name)).config;

export const getAiConfig = () => load("ai");
export const getSearchConfig = () => load("search");
export const getAccessConfig = () => load("access");
export const getSurveyConfig = () => load("survey");

/** Save a section. Empty secret fields keep the stored value, so the admin page never needs to see the key. */
export async function saveConfig<N extends Name>(name: N, value: Sections[N]) {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, name));
  const out: Record<string, unknown> = { ...value };
  // A blank field keeps the stored blob as is, so saving other settings never wipes (or re-encrypts) a key it can't read.
  for (const f of SECRET_FIELDS[name]) out[f] = nextSecret((out[f] as string) || "", row?.value?.[f], encrypt);
  await db
    .insert(schema.appSettings)
    .values({ key: name, value: out })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: out, updatedAt: new Date() } });
}

/** Config as the admin page sees it: secrets masked. */
export async function publicConfig() {
  const [aiS, searchS, access] = await Promise.all([loadWithStatus("ai"), loadWithStatus("search"), getAccessConfig()]);
  const ai = aiS.config;
  const search = searchS.config;
  const [seen] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "agent_seen"));
  return {
    agent: { tokenSet: (process.env.AGENT_TOKEN ?? "").length >= 32, lastSeen: (seen?.value?.at as string | undefined) ?? null },
    ai: { ...ai, apiKey: "", apiKeyHint: mask(ai.apiKey), apiKeyUnreadable: aiS.unreadable.includes("apiKey") },
    search: { ...search, braveKey: "", braveKeyHint: mask(search.braveKey), braveKeyUnreadable: searchS.unreadable.includes("braveKey") },
    access,
  };
}
