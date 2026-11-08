import { afterEach, describe, expect, it, vi } from "vitest";
import { featureOn } from "./features";

afterEach(() => vi.unstubAllEnvs());

describe("featureOn", () => {
  it("is on only for the exact value on", () => {
    vi.stubEnv("FEATURE_EVENTS", "on");
    expect(featureOn("EVENTS")).toBe(true);
    for (const v of ["", "ON", "true", "1", "yes"]) {
      vi.stubEnv("FEATURE_EVENTS", v);
      expect(featureOn("EVENTS"), v).toBe(false);
    }
  });

  it("is off when unset, and each switch is separate", () => {
    vi.stubEnv("FEATURE_EVENTS", "on");
    vi.stubEnv("FEATURE_SEARCHES", undefined);
    expect(featureOn("SEARCHES")).toBe(false);
  });
});
