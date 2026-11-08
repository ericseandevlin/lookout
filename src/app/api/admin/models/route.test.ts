import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
  process.env.ADMIN_EMAILS = "";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let me: { id: string; email: string; isAdmin: boolean } | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));

const fetchMock = vi.fn<typeof fetch>();
const answer = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });

// The route caches per source at module level; load a fresh copy for each test.
let GET: (req: Request, ctx: object) => Promise<Response>;
const list = async (source?: string) => {
  const res = await GET(new Request(`https://lookout.test/api/admin/models${source ? `?source=${source}` : ""}`), {});
  return { status: res.status, body: await res.json() };
};

beforeEach(async () => {
  vi.resetModules();
  ({ GET } = await import("./route"));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  me = { id: "u1", email: "admin@example.com", isAdmin: true };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GET /api/admin/models (#435)", () => {
  it("lists OpenRouter models in dollars per million, cheapest first, routers dropped", async () => {
    fetchMock.mockResolvedValueOnce(
      answer([
        { id: "big/model", name: "Big", context_length: 200000, pricing: { prompt: "0.000003", completion: "0.000015" }, supported_parameters: ["tools", "structured_outputs"] },
        { id: "openrouter/auto", name: "Auto", pricing: { prompt: "-1", completion: "-1" } },
        { id: "small/model", name: "Small", context_length: 32000, pricing: { prompt: "0.0000001", completion: "0.0000004" }, supported_parameters: ["response_format"] },
        { id: "free/model", name: "Free", supported_parameters: ["tools"] },
      ]),
    );
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/models");
    expect(body.models).toEqual([
      { id: "free/model", name: "Free", context: 0, priceIn: 0, priceOut: 0, structured: false },
      { id: "small/model", name: "Small", context: 32000, priceIn: 0.1, priceOut: 0.4, structured: true },
      { id: "big/model", name: "Big", context: 200000, priceIn: 3, priceOut: 15, structured: true },
    ]);
  });

  it("lists only the OpenCode families Lookout can call, by id, with no prices", async () => {
    fetchMock.mockResolvedValue(answer([{ id: "kimi-k2" }, { id: "claude-sonnet-4" }, { id: "GLM-4.6" }, { id: "gpt-5" }, { id: "deepseek-v3" }]));
    const zen = await list("opencode");
    expect(fetchMock.mock.calls[0][0]).toBe("https://opencode.ai/zen/v1/models");
    expect(zen.body.models.map((m: { id: string }) => m.id)).toEqual(["deepseek-v3", "GLM-4.6", "kimi-k2"]);
    expect(zen.body.models[0]).toEqual({ id: "deepseek-v3", name: "deepseek-v3", context: 0, priceIn: null, priceOut: null, structured: null });

    await list("opencode-go");
    expect(fetchMock.mock.calls[1][0]).toBe("https://opencode.ai/zen/go/v1/models");
  });

  it("falls back to OpenRouter for an unknown source", async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    await list("somewhere-else");
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/models");
  });

  it("caches each source for an hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fetchMock.mockImplementation(async () => answer([{ id: "glm-4.6" }]));
    await list("opencode");
    await list("opencode");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Another source has its own cache.
    await list("opencode-go");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(3600_000);
    await list("opencode");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("answers 502 when the provider fails, and doesn't cache the failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    expect(await list()).toEqual({ status: 502, body: { error: "OpenRouter answered 503" } });

    fetchMock.mockResolvedValueOnce(new Response("down", { status: 500 }));
    expect(await list("opencode")).toEqual({ status: 502, body: { error: "OpenCode answered 500" } });

    fetchMock.mockResolvedValueOnce(answer([]));
    expect((await list()).status).toBe(200);
  });

  it("is for admins only", async () => {
    me = { id: "u2", email: "someone@example.com", isAdmin: false };
    expect((await list()).status).toBe(403);
    me = null;
    expect((await list()).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
