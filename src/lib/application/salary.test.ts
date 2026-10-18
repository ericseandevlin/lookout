import { describe, expect, it } from "vitest";
import { isSalaryQuestion, suggestSalary } from "./salary";

describe("suggestSalary", () => {
  it("anchors in the top quarter of the range, above the floor (Red Ventures)", () => {
    const r = suggestSalary({ floor: "220,000", min: 230000, max: 260000, totalCash: true, asksBase: true })!;
    // 230k + 75% of the 30k spread = 252.5k, rounded to the nearest 5k.
    expect(r.amount).toBe("$255,000");
    expect(r.note).toMatch(/top quarter/);
    expect(r.note).toMatch(/asks for base/);
  });

  it("uses the target when it sits inside the range", () => {
    expect(suggestSalary({ floor: "220000", target: "255k", min: 230000, max: 260000 })!.amount).toBe("$255,000");
  });

  it("caps at the posted max", () => {
    expect(suggestSalary({ floor: "200000", target: "300000", min: 230000, max: 260000 })!.amount).toBe("$260,000");
  });

  it("gives the floor and flags it when the floor is above their range (Impiricus)", () => {
    const r = suggestSalary({ floor: "220000", min: 180000, max: 200000 })!;
    expect(r.amount).toBe("$220,000");
    expect(r.note).toMatch(/may not meet your minimum/);
  });

  it("falls back to target or floor without a range, else nothing", () => {
    expect(suggestSalary({ floor: "220000", target: "260000" })!.amount).toBe("$260,000");
    expect(suggestSalary({})).toBeNull();
  });
});

describe("isSalaryQuestion", () => {
  it("knows salary asks, not salary history", () => {
    expect(isSalaryQuestion("What is your desired base salary?")).toBe(true);
    expect(isSalaryQuestion("What is your base salary expectation?")).toBe(true);
    expect(isSalaryQuestion("What is your current salary?")).toBe(false);
  });
});
