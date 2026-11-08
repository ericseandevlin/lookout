import { describe, expect, it } from "vitest";
import { OLD_SALARY_KEYS, SALARY_RANGES, salaryRange } from "./onboarding";

describe("salaryRange", () => {
  it("finds each band by its key", () => {
    for (const r of SALARY_RANGES) expect(salaryRange(r.key)).toBe(r);
  });

  it("maps the keys from before the bands widened (#252)", () => {
    expect(salaryRange("120_160")?.key).toBe("120_170");
    expect(salaryRange("160_220")?.key).toBe("170_250");
    expect(salaryRange("220p")?.key).toBe("250p");
    for (const k of Object.values(OLD_SALARY_KEYS)) expect(salaryRange(k)).toBeDefined();
  });

  it("is undefined for no key or an unknown one", () => {
    expect(salaryRange(undefined)).toBeUndefined();
    expect(salaryRange("")).toBeUndefined();
    expect(salaryRange("999k")).toBeUndefined();
  });
});
