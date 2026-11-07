import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

const { getAiConfig, getSearchConfig, getAccessConfig, getSurveyConfig, saveConfig, publicConfig } = await import("./config");

const A = "a".repeat(32);
const B = "b".repeat(32);
const stored = async (key: string) => (await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)))[0]?.value;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.appSettings);
  vi.stubEnv("APP_SECRET", A);
  vi.stubEnv("APP_SECRET_PREVIOUS", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("defaults", () => {
  it("come from env vars when nothing is saved", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-env");
    vi.stubEnv("AI_MODEL", "claude-test");
    vi.stubEnv("AI_JSON_MODE", "object");
    vi.stubEnv("SEARCH_PROVIDER", "brave");
    vi.stubEnv("BRAVE_API_KEY", "brave-env");
    vi.stubEnv("SIGNUP_MODE", "open");
    const ai = await getAiConfig();
    expect(ai).toMatchObject({ provider: "anthropic", model: "claude-test", apiKey: "sk-ant-env", jsonMode: "object", privacy: "strict" });
    expect(await getSearchConfig()).toMatchObject({ provider: "brave", braveKey: "brave-env" });
    expect((await getAccessConfig()).signupMode).toBe("open");
    expect(await getSurveyConfig()).toEqual({ everyDays: 5 });
  });

  it("fall back to OpenRouter and an unknown provider becomes openai", async () => {
    vi.stubEnv("AI_PROVIDER", "something-else");
    vi.stubEnv("AI_BASE_URL", "");
    const ai = await getAiConfig();
    expect(ai.provider).toBe("openai");
    expect(ai.baseUrl).toBe("https://openrouter.ai/api/v1");
  });
});

describe("saveConfig", () => {
  it("stores keys encrypted and reads them back in plain text", async () => {
    const ai = { ...(await getAiConfig()), apiKey: "sk-saved-1234", model: "saved-model" };
    await saveConfig("ai", ai);
    const row = await stored("ai");
    expect(row?.apiKey).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain("sk-saved-1234");
    expect(await getAiConfig()).toMatchObject({ apiKey: "sk-saved-1234", model: "saved-model" });

    await saveConfig("search", { ...(await getSearchConfig()), braveKey: "brave-saved" });
    expect(JSON.stringify(await stored("search"))).not.toContain("brave-saved");
    expect((await getSearchConfig()).braveKey).toBe("brave-saved");
  });

  it("keeps the stored key when the key field is left blank", async () => {
    await saveConfig("ai", { ...(await getAiConfig()), apiKey: "sk-keep-me" });
    const blob = (await stored("ai"))?.apiKey;
    await saveConfig("ai", { ...(await getAiConfig()), apiKey: "", model: "other-model" });
    expect((await stored("ai"))?.apiKey).toBe(blob);
    expect(await getAiConfig()).toMatchObject({ apiKey: "sk-keep-me", model: "other-model" });
  });

  it("saved values win over env defaults", async () => {
    vi.stubEnv("AI_MODEL", "env-model");
    await saveConfig("ai", { ...(await getAiConfig()), model: "saved-model" });
    expect((await getAiConfig()).model).toBe("saved-model");
  });
});

describe("publicConfig", () => {
  it("never returns a key, only a masked hint", async () => {
    await saveConfig("ai", { ...(await getAiConfig()), apiKey: "sk-or-v1-secretvalue" });
    await saveConfig("search", { ...(await getSearchConfig()), braveKey: "BSAsecretbrave" });
    const pub = await publicConfig();
    expect(pub.ai.apiKey).toBe("");
    expect(pub.ai.apiKeyHint).toBe("sk-o…alue");
    expect(pub.ai.apiKeyUnreadable).toBe(false);
    expect(pub.search.braveKey).toBe("");
    expect(pub.search.braveKeyHint).toBe("BSAs…rave");
    expect(JSON.stringify(pub)).not.toMatch(/secretvalue|secretbrave/);
  });

  it("reports whether the agent token is set and when the agent was last seen", async () => {
    vi.stubEnv("AGENT_TOKEN", "short");
    expect((await publicConfig()).agent).toEqual({ tokenSet: false, lastSeen: null });
    vi.stubEnv("AGENT_TOKEN", "t".repeat(32));
    await db.insert(schema.appSettings).values({ key: "agent_seen", value: { at: "2026-11-07T12:00:00Z" } });
    expect((await publicConfig()).agent).toEqual({ tokenSet: true, lastSeen: "2026-11-07T12:00:00Z" });
  });
});

describe("a saved key that can't be decrypted (#274)", () => {
  it("becomes empty, is flagged, and does not fall back to the env key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("AI_API_KEY", "sk-old-leaked-env-key");
    await saveConfig("ai", { ...(await getAiConfig()), apiKey: "sk-saved-under-a" });
    vi.stubEnv("APP_SECRET", B);
    expect((await getAiConfig()).apiKey).toBe("");
    const pub = await publicConfig();
    expect(pub.ai.apiKeyUnreadable).toBe(true);
    expect(pub.ai.apiKeyHint).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("is left untouched by a save with a blank key, so it can still be read after the secret comes back", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await saveConfig("ai", { ...(await getAiConfig()), apiKey: "sk-survives" });
    vi.stubEnv("APP_SECRET", B);
    await saveConfig("ai", { ...(await getAiConfig()), apiKey: "", model: "changed" });
    vi.stubEnv("APP_SECRET", A);
    expect(await getAiConfig()).toMatchObject({ apiKey: "sk-survives", model: "changed" });
  });
});
