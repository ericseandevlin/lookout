import { describe, expect, it } from "vitest";
import { isSalaryQuestion, rangeBasis, suggestSalary } from "./salary";

describe("suggestSalary", () => {
  // Quill's criteria 1 and 3 first: these are the cases where a wrong number looks confident.
  it("asks in the top quarter of 100-140 with a floor of 120, never above 140", () => {
    const r = suggestSalary({ floor: "120000", min: 100000, max: 140000 })!;
    expect(r.amount).toBe("$130,000");
    expect(r.note).toMatch(/top quarter/);
    expect(r.question).toBeUndefined();
  });

  it("never undercuts a floor inside the top quarter", () => {
    expect(suggestSalary({ floor: "135000", min: 100000, max: 140000 })!.amount).toBe("$135,000");
  });

  it("gives no number and says why when the floor is above their max (Impiricus)", () => {
    const r = suggestSalary({ floor: "220000", target: "260000", min: 180000, max: 200000 })!;
    expect(r.amount).toBeNull();
    expect(r.note).toMatch(/above their posted max/);
    expect(r.note).toMatch(/may not meet your minimum/);
    expect(r.question).toMatch(/Decide/);
  });

  it("uses the target when it sits inside the range", () => {
    expect(suggestSalary({ floor: "220000", target: "255k", min: 230000, max: 260000 })!.amount).toBe("$255,000");
    expect(suggestSalary({ floor: "100000", target: "110k", min: 100000, max: 140000 })!.amount).toBe("$110,000");
  });

  it("caps at the posted max", () => {
    expect(suggestSalary({ floor: "200000", target: "300000", min: 230000, max: 260000 })!.amount).toBe("$260,000");
  });

  it("does not answer a base question with a total-cash range (Red Ventures)", () => {
    const r = suggestSalary({ floor: "220,000", min: 230000, max: 260000, basis: "total", asksBase: true })!;
    expect(r.amount).toBeNull();
    expect(r.note).toMatch(/total cash, but this question asks for base/);
    expect(r.question).toMatch(/base salary/);
  });

  it("answers a total-cash range when the question doesn't ask base", () => {
    const r = suggestSalary({ floor: "220,000", min: 230000, max: 260000, basis: "total" })!;
    // 230k + 75% of the 30k spread = 252.5k, rounded to the nearest 5k.
    expect(r.amount).toBe("$255,000");
    expect(r.note).toMatch(/total cash including bonus/);
  });

  it("says when it can't tell base from total cash, without picking one", () => {
    const r = suggestSalary({ min: 230000, max: 260000, basis: null, asksBase: true })!;
    expect(r.note).toMatch(/doesn't say whether .* is base or total cash/);
    expect(r.question).toMatch(/base or total cash/);
    expect(suggestSalary({ min: 230000, max: 260000, basis: "base", asksBase: true })!.question).toBeUndefined();
  });

  it("explains why a minimum question still gets an in-range answer (Understood)", () => {
    const r = suggestSalary({ floor: "220000", min: 235000, max: 250000, asksMinimum: true })!;
    expect(r.amount).toBe("$245,000");
    expect(r.note).toMatch(/asks for your minimum/);
  });

  it("states one number without a range, and never invents one", () => {
    const r = suggestSalary({ floor: "220000", target: "260000" })!;
    expect(r.amount).toBe("$260,000");
    expect(r.note).not.toMatch(/–|-\s*\$/);
    expect(suggestSalary({ floor: "220000" })!.amount).toBe("$220,000");
    expect(suggestSalary({})).toBeNull();
  });
});

describe("rangeBasis", () => {
  it("reads what the posted range covers", () => {
    expect(rangeBasis("Total cash compensation: $230k-$260k")).toBe("total");
    expect(rangeBasis("The range includes a target bonus.")).toBe("total");
    expect(rangeBasis("Base salary range: $100,000 - $140,000")).toBe("base");
    expect(rangeBasis("Salary: $100,000 - $140,000")).toBeNull();
  });
});

describe("isSalaryQuestion", () => {
  it("knows salary asks, not salary history", () => {
    expect(isSalaryQuestion("What is your desired base salary?")).toBe(true);
    expect(isSalaryQuestion("What is your base salary expectation?")).toBe(true);
    expect(isSalaryQuestion("What is your current salary?")).toBe(false);
  });
});

describe("salary note wording", () => {
  it("at their max, says to negotiate the rest of the offer, not 'room to negotiate'", () => {
    const r = suggestSalary({ floor: "220000", target: "300000", min: 235000, max: 250000 })!;
    expect(r.amount).toBe("$250,000");
    expect(r.note).toMatch(/posted max/);
    expect(r.note).toMatch(/bonus, equity/);
    expect(r.note).not.toMatch(/room to negotiate down/);
  });

  it("in the top quarter, explains the room to negotiate down", () => {
    expect(suggestSalary({ floor: "200000", min: 230000, max: 260000 })!.note).toMatch(/room to negotiate down/);
  });
});
