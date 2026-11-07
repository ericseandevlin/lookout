import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { samConfigured, searchOn } = await import("./sources");

describe("searchOn (#272)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("keeps rfp off without a SAM.gov key and jobs always on", () => {
    vi.stubEnv("SAM_API_KEY", "");
    expect(samConfigured()).toBe(false);
    expect(searchOn("rfp")).toBe(false);
    expect(searchOn("job")).toBe(true);
  });
  it("turns rfp on once the key is set", () => {
    vi.stubEnv("SAM_API_KEY", "x".repeat(40));
    expect(searchOn("rfp")).toBe(true);
  });
});
