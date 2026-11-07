import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn(), refreshSession: vi.fn() }));
vi.mock("@/lib/ai/llm", () => ({ AiConfigError: class AiConfigError extends Error {} }));
vi.mock("@/lib/ai/runs", () => ({ BudgetError: class BudgetError extends Error {} }));
vi.mock("@/lib/ai/search", () => ({ SearchConfigError: class SearchConfigError extends Error {} }));
const { recordError } = vi.hoisted(() => ({ recordError: vi.fn() }));
vi.mock("@/lib/errorLog", () => ({ recordError }));

const { allowedOrigins, errorResponse, HttpError } = await import("./api");
const { AiConfigError } = await import("@/lib/ai/llm");
const { BudgetError } = await import("@/lib/ai/runs");
const { SearchConfigError } = await import("@/lib/ai/search");

const read = async (r: Response) => ({ status: r.status, body: await r.json() });

describe("errorResponse (#201)", () => {
  it("passes HttpError through", async () => expect(await read(errorResponse(new HttpError(409, "Busy")))).toEqual({ status: 409, body: { error: "Busy" } }));

  it("says the budget is used up, as a 429, without logging a crash", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await read(errorResponse(new BudgetError("Lookout hit its daily spend cap. Try again tomorrow.")))).toEqual({ status: 429, body: { error: "Lookout hit its daily spend cap. Try again tomorrow." } });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("says AI or search isn't set up, as a 503", async () => {
    expect((await read(errorResponse(new AiConfigError("No AI model is set.")))).status).toBe(503);
    expect((await read(errorResponse(new SearchConfigError("No search provider.")))).body.error).toBe("No search provider.");
  });

  it("keeps unknown errors generic and logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await read(errorResponse(new Error("db password in here")))).toEqual({ status: 500, body: { error: "Something went wrong" } });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("keeps unknown errors for Admin > Errors with the path and method (#12)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = new Error("boom");
    errorResponse(e, new Request("https://lookout.example/api/finds?token=secret", { method: "POST" }));
    await vi.waitFor(() => expect(recordError).toHaveBeenCalledWith("route", e, { path: "/api/finds", method: "POST" }));
    recordError.mockClear();
    errorResponse(new HttpError(404, "Not found"));
    await new Promise((r) => setTimeout(r, 10));
    expect(recordError).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("allowedOrigins (#209)", () => {
  const app = "https://lookout.example";
  it("production allows the app and EXTRA_ORIGINS, never localhost", () => {
    const o = allowedOrigins(app, { NODE_ENV: "production", EXTRA_ORIGINS: "https://alias.example/, https://b.example" });
    expect([...o]).toEqual([app, "https://alias.example", "https://b.example"]);
    expect(o.has("http://localhost:3000")).toBe(false);
  });
  it("development also allows localhost on its port", () => {
    expect(allowedOrigins(app, { NODE_ENV: "development", PORT: "4000" }).has("http://localhost:4000")).toBe(true);
  });
});
