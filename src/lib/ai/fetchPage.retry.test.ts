import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { FetchError, retryAfterMs } = await import("./fetchPage");

describe("retryAfterMs (#1724)", () => {
  it("reads seconds", () => {
    expect(retryAfterMs("5")).toBe(5_000);
    expect(retryAfterMs(" 0 ")).toBe(0);
  });

  it("reads an HTTP date as the time left, never below zero", () => {
    const now = Date.parse("2026-11-24T12:00:00Z");
    expect(retryAfterMs("Tue, 24 Nov 2026 12:00:03 GMT", now)).toBe(3_000);
    expect(retryAfterMs("Tue, 24 Nov 2026 11:59:00 GMT", now)).toBe(0);
  });

  it("is undefined when missing or unreadable", () => {
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs("")).toBeUndefined();
    expect(retryAfterMs("soon")).toBeUndefined();
  });
});

describe("FetchError (#1724)", () => {
  it("carries the status and the wait the site asked for", () => {
    const e = new FetchError("The page answered 429", { status: 429, retryAfterMs: 2_000 });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("The page answered 429");
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(2_000);
  });

  it("works with a message alone", () => {
    expect(new FetchError("Too many redirects").status).toBeUndefined();
  });
});
