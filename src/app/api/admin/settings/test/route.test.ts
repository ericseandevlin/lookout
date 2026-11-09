import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
  process.env.ADMIN_EMAILS = "";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let me: { id: string; email: string; isAdmin: boolean } | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));

// Stored settings and the three probes; the route only wires them together.
const stored = vi.hoisted(() => ({ ai: { apiKey: "stored-ai-key" }, search: { braveKey: "stored-brave-key" } }));
vi.mock("@/lib/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/config")>()),
  getAiConfig: async () => stored.ai,
  getSearchConfig: async () => stored.search,
}));
const testModel = vi.fn();
const testSearch = vi.fn();
const fetchPage = vi.fn();
vi.mock("@/lib/ai/llm", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/llm")>()), testModel }));
vi.mock("@/lib/ai/search", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/search")>()), testSearch }));
vi.mock("@/lib/ai/fetchPage", () => ({ fetchPage, pageToText: (html: string) => html.replace(/<[^>]+>/g, "") }));

const { POST } = await import("./route");

const post = async (data: unknown) => {
  const res = await POST(
    new Request("https://lookout.test/api/admin/settings/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }),
    {},
  );
  return { status: res.status, body: await res.json() };
};

const ai = (apiKey: string) => ({
  section: "ai",
  values: { provider: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "m", apiKey, priceIn: 1, priceOut: 2, jsonMode: "schema", privacy: "strict" },
});
const search = (braveKey: string) => ({
  section: "search",
  values: { provider: "brave", searxngUrl: "https://searx.test", braveKey, pricePerQuery: 0.005 },
});

beforeEach(() => {
  me = { id: "u1", email: "admin@example.com", isAdmin: true };
  testModel.mockReset().mockResolvedValue({ ok: true, ms: 12 });
  testSearch.mockReset().mockResolvedValue({ ok: true, results: 3 });
  fetchPage.mockReset();
});

describe("POST /api/admin/settings/test (#565)", () => {
  it("is for admins only", async () => {
    me = null;
    expect((await post(ai(""))).status).toBe(401);
    me = { id: "u2", email: "someone@example.com", isAdmin: false };
    expect((await post(ai(""))).status).toBe(403);
    expect(testModel).not.toHaveBeenCalled();
  });

  it("refuses an unknown section or a bad value", async () => {
    expect((await post({ section: "mail" })).status).toBe(400);
    expect((await post({ section: "fetch", url: "not a url" })).status).toBe(400);
    expect((await post({ ...ai("k"), values: { ...ai("k").values, provider: "gemini" } })).status).toBe(400);
  });

  it("tries the model with the stored key when the form leaves it blank", async () => {
    const { status, body } = await post(ai(""));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, ms: 12 });
    expect(testModel.mock.calls[0][0]).toMatchObject({ model: "m", apiKey: "stored-ai-key" });
  });

  it("uses a key typed on the form over the stored one", async () => {
    await post(ai("typed-key"));
    expect(testModel.mock.calls[0][0].apiKey).toBe("typed-key");
  });

  it("tries search with the stored Brave key when blank, or the typed one", async () => {
    expect((await post(search(""))).body).toEqual({ ok: true, results: 3 });
    await post(search("new-brave"));
    expect(testSearch.mock.calls.map((c) => c[0].braveKey)).toEqual(["stored-brave-key", "new-brave"]);
  });

  it("fetches a page and reports the final url, text length and time", async () => {
    fetchPage.mockResolvedValue({ url: "https://jobs.test/final", html: "<p>hello</p>" });
    const { body } = await post({ section: "fetch", url: "https://jobs.test/start" });
    expect(fetchPage).toHaveBeenCalledWith("https://jobs.test/start");
    expect(body).toMatchObject({ ok: true, url: "https://jobs.test/final", chars: 5 });
    expect(typeof body.ms).toBe("number");
  });

  it("turns a failure into ok:false with the message cut to 300 characters", async () => {
    testModel.mockRejectedValue(new Error("x".repeat(400)));
    const { status, body } = await post(ai("k"));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: false, error: "x".repeat(300) });
    fetchPage.mockRejectedValue("not an error");
    expect((await post({ section: "fetch", url: "https://jobs.test" })).body).toEqual({ ok: false, error: "Failed" });
  });
});
