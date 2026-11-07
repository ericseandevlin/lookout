import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let auth: string | null = null;
vi.mock("next/headers", () => ({ headers: async () => new Headers(auth ? { authorization: auth } : {}) }));
// The real api module loads the database and AI clients; agentRoute only needs these two.
vi.mock("@/lib/api", () => ({
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
  json: (data: unknown, init?: ResponseInit) => Response.json(data, init),
}));

const { agentRoute } = await import("./agentAuth");

const TOKEN = "t".repeat(40);
const route = agentRoute(async () => Response.json({ ok: true }));
const call = async (header: string | null) => {
  auth = header;
  return route(new Request("https://lookout.test/api/agent"), {});
};

beforeEach(() => {
  vi.stubEnv("AGENT_TOKEN", TOKEN);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agentRoute", () => {
  it("lets the right bearer token through", async () => {
    expect((await call(`Bearer ${TOKEN}`)).status).toBe(200);
    expect((await call(`bearer ${TOKEN}`)).status).toBe(200);
  });

  it("refuses a missing, wrong or partial token", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call(`Bearer ${"u".repeat(40)}`)).status).toBe(401);
    expect((await call(`Bearer ${TOKEN.slice(0, 20)}`)).status).toBe(401);
    expect((await call(`Bearer ${TOKEN}x`)).status).toBe(401);
  });

  it("refuses everything when the server token is short or unset", async () => {
    vi.stubEnv("AGENT_TOKEN", "short");
    expect((await call("Bearer short")).status).toBe(401);
    vi.stubEnv("AGENT_TOKEN", "");
    expect((await call("Bearer ")).status).toBe(401);
  });

  it("turns a crash in the handler into a plain 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    auth = `Bearer ${TOKEN}`;
    const res = await agentRoute(async () => {
      throw new Error("boom");
    })(new Request("https://lookout.test/api/agent"), {});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong" });
  });
});
