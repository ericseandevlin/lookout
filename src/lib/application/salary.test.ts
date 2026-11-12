import { describe, expect, it } from "vitest";
import { asksBase, isSalaryQuestion, rangeBasis, suggestSalary } from "./salary";

describe("suggestSalary", () => {
  // Quill's criteria 1 and 3 first: these are the cases where a wrong number looks confident.
  it("asks in the top quarter of 100-140 with a floor of 120, never above 140", () => {
    const r = suggestSalary({ floor: "120000", min: 100000, max: 140000 })!;
    expect(r.amount).toBe("$130,000");
    expect(r.note).toMatch(/Top quarter/);
    expect(r.question).toBeUndefined();
  });

  it("reads a floor typed as \"150\" as $150,000 (#761)", () => {
    expect(suggestSalary({ floor: "150", min: 100000, max: 140000 })!.amount).toBeNull();
    expect(suggestSalary({ floor: "135", min: 100000, max: 140000 })!.amount).toBe("$135,000");
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

  it("asks the top quarter when the target is above their range (Eric's rule, not their max)", () => {
    expect(suggestSalary({ floor: "200000", target: "300000", min: 230000, max: 260000 })!.amount).toBe("$255,000");
  });

  it("never asks below the posted min when rounding steps out of a narrow range (#507)", () => {
    const r = suggestSalary({ min: 101000, max: 102000 })!;
    expect(r.amount).toBe("$101,000");
    expect(r.note).toMatch(/Top quarter of their range \(\$101,000\)/);
    expect(suggestSalary({ min: 201000, max: 203000 })!.amount).toBe("$203,000");
    expect(suggestSalary({ floor: "90000", min: 151000, max: 152000 })!.amount).toBe("$151,000");
  });

  it("never goes above the posted max, even for a floor near it", () => {
    expect(suggestSalary({ floor: "259000", min: 230000, max: 260000 })!.amount).toBe("$259,000");
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
    expect(r.note).toMatch(/doesn't say whether this range is base or total cash/);
    expect(r.question).toMatch(/base or total cash/);
    expect(suggestSalary({ min: 230000, max: 260000, basis: "base", asksBase: true })!.question).toBeUndefined();
  });

  it("explains why a minimum question still gets an in-range answer (Understood)", () => {
    const r = suggestSalary({ floor: "220000", min: 235000, max: 250000, asksMinimum: true })!;
    expect(r.amount).toBe("$245,000");
    expect(r.note).toMatch(/Minimum question/);
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

  it("reads a range that doesn't include bonus as base, not total cash (#650)", () => {
    expect(rangeBasis("The base salary range is $150,000-$180,000. This range does not include bonus or equity.")).toBe("base");
    expect(rangeBasis("Base pay: $150k-$180k. The pay range doesn't include a bonus.")).toBe("base");
    expect(rangeBasis("Base salary $150k-$180k, excluding bonus")).toBe("base");
  });

  it("ignores a bonus in a benefits list (#650)", () => {
    expect(rangeBasis("Base pay range: $150k-$180k. Our total rewards include a bonus program.")).toBe("base");
    expect(rangeBasis("Perks include bonus eligibility and 401(k).")).toBeNull();
  });

  it.each([
    "Our salary ranges include base salary and target bonus.",
    "This range includes base pay plus bonus.",
    "The pay range includes base salary and on-target commission.",
    "The range above reflects base salary plus target incentive.",
    "The range shown includes base salary, bonus and equity.",
    "The range is base + bonus.",
    "On-target earnings: $150,000 - $200,000",
    "Total compensation range: $200,000 - $250,000",
    "Total target compensation: $180,000 - $220,000",
  ])("reads %s as total cash (#690)", (posting) => {
    expect(rangeBasis(posting)).toBe("total");
  });

  it("keeps a bonus paid on top of the range as base (#690)", () => {
    expect(rangeBasis("Base salary range: $150k-$180k. This role is eligible for a bonus in addition to base salary.")).toBe("base");
    expect(rangeBasis("The base salary range is $150k-$180k, and the bonus is paid separately.")).toBe("base");
    expect(rangeBasis("Base pay range: $150k-$180k. The range does not reflect bonus or commission.")).toBe("base");
    expect(rangeBasis("Base salary range: $150k-$180k. We offer competitive total compensation and great benefits.")).toBe("base");
  });

  it("reads total cash or OTE only where it names the range (#795)", () => {
    expect(rangeBasis("The base salary range for this role is $150,000 - $180,000. Beyond base pay, this role is eligible for an annual bonus, so total cash compensation may be higher.")).toBe("base");
    expect(rangeBasis("The base salary range is $150,000 - $180,000. This range is not OTE.")).toBe("base");
    expect(rangeBasis("Base salary range: $150k-$180k. Total cash isn't capped for top performers.")).toBe("base");
    expect(rangeBasis("OTE $200,000 - $250,000")).toBe("total");
    expect(rangeBasis("Total cash range is $230k to $260k.")).toBe("total");
    expect(rangeBasis("Total Cash\n$200,000 - $250,000")).toBe("total");
    expect(rangeBasis("Compensation (OTE): $180k - $220k")).toBe("total");
  });
});

describe("asksBase", () => {
  it("is base only when the question doesn't add bonus or commission (#650)", () => {
    expect(asksBase("Expected base salary")).toBe(true);
    expect(asksBase("Expected annual compensation (base + bonus)")).toBe(false);
    expect(asksBase("Desired base plus commission")).toBe(false);
    expect(asksBase("Salary expectations")).toBe(false);
  });
});

describe("isSalaryQuestion", () => {
  it("knows salary asks, not salary history", () => {
    expect(isSalaryQuestion("What is your desired base salary?")).toBe(true);
    expect(isSalaryQuestion("What is your base salary expectation?")).toBe(true);
    expect(isSalaryQuestion("What is your current salary?")).toBe(false);
  });

  it("still sees the ask when the prompt mentions history or a current range (#640)", () => {
    expect(isSalaryQuestion("What are your salary expectations? We do not ask about salary history.")).toBe(true);
    expect(isSalaryQuestion("What is your expected salary? Our range is listed in the current posting.")).toBe(true);
    expect(isSalaryQuestion("Expected salary (our current range is in the posting)")).toBe(true);
    expect(isSalaryQuestion("What are your compensation expectations?\nLast day to apply is Friday.")).toBe(true);
  });

  it("still sees the ask when the prompt says it doesn't need past pay (#652)", () => {
    expect(isSalaryQuestion("Desired salary (we do not need your current salary)")).toBe(true);
    expect(isSalaryQuestion("Expected salary (current salary not required)")).toBe(true);
    expect(isSalaryQuestion("What are your salary expectations? Please don't include your current compensation.")).toBe(true);
    expect(isSalaryQuestion("Desired compensation, we won't ask for your previous salary")).toBe(true);
    expect(isSalaryQuestion("What is your current salary? This is optional.")).toBe(false);
  });

  it("leaves out questions about the person's own past pay (#640)", () => {
    for (const q of ["Salary history", "What was your previous base salary?", "What is your most recent compensation?", "What was your salary at your last job?", "Please share your compensation history."])
      expect(isSalaryQuestion(q)).toBe(false);
  });

  it("leaves out yes/no questions about their posted range (#687)", () => {
    for (const q of [
      "Are you comfortable with the posted salary range for this role?",
      "Is the compensation range listed acceptable to you?",
      "Does the salary range above work for you?",
      "Do you agree the stated pay range meets your needs?",
    ])
      expect(isSalaryQuestion(q)).toBe(false);
  });

  it("still sees asks phrased as a yes/no or with other words (#687)", () => {
    for (const q of ["Would you share your salary expectations?", "Can you tell us your desired compensation?", "Wage expectations", "How much do you expect to earn?", "What is your expected salary range?"])
      expect(isSalaryQuestion(q)).toBe(true);
    expect(isSalaryQuestion("What is your current hourly wage?")).toBe(false);
  });

  it("leaves out questions that only mention pay (#712)", () => {
    for (const q of [
      "Describe a time you negotiated compensation for your team.",
      "Do you have experience designing compensation tools?",
      "Have you ever filed a workers' compensation claim?",
      "Are you willing to relocate? This role's salary is set for NYC.",
      "How did you hear about this role? (Salary transparency note: range $X-$Y)",
    ])
      expect(isSalaryQuestion(q)).toBe(false);
  });

  it("still sees short labels and asks for their own number (#712)", () => {
    for (const q of ["Salary", "Salary (USD)", "Compensation", "Please share your compensation range.", "What salary are you looking for?", "Annual salary you are seeking"])
      expect(isSalaryQuestion(q)).toBe(true);
  });
});

describe("isSalaryQuestion (#813)", () => {
  it.each([
    "What are you hoping to make in this role?",
    "How much would you like to earn?",
    "What are you looking to earn annually?",
    "How much do you want to make in your next role?",
    "What do you need to make to accept an offer?",
  ])("reads %s as a salary ask", (q) => {
    expect(isSalaryQuestion(q)).toBe(true);
  });

  it.each([
    "What impact do you hope to make in your first 90 days?",
    "What difference do you want to make here?",
    "We are looking to make a hire quickly. When can you start?",
    "What change would you like to make to our design system?",
    "Are you hoping to make a move into management?",
  ])("leaves %s alone", (q) => {
    expect(isSalaryQuestion(q)).toBe(false);
  });
});

describe("isSalaryQuestion (#718)", () => {
  it("leaves out yes/no range checks that mention expectations", () => {
    for (const q of ["Does the salary range of $120k-$150k meet your expectations?", "Is your salary expectation within the posted range?", "Do your compensation expectations align with the range above?"])
      expect(isSalaryQuestion(q), q).toBe(false);
  });

  it("leaves out What questions about pay work", () => {
    for (const q of ["What compensation tools have you built?", "What is your experience with compensation benchmarking?", "What experience do you have running payroll and salary reviews?", "What is your compensation philosophy as a manager?"])
      expect(isSalaryQuestion(q), q).toBe(false);
  });

  it("still sees asks that mention experience or a range", () => {
    for (const q of ["Based on your experience, what are your salary expectations?", "What salary would you expect, given your experience?", "Can you provide your expected salary range?", "What salary are you seeking for this role?", "Minimum salary you would accept", "Lowest base salary you would consider"])
      expect(isSalaryQuestion(q), q).toBe(true);
  });
});

describe("salary note wording", () => {
  it("states the three rules with why, using the real numbers (Understood)", () => {
    const r = suggestSalary({ floor: "220000", target: "260000", min: 235000, max: 250000, asksMinimum: true })!;
    expect(r.amount).toBe("$245,000");
    expect(r.note).toBe(
      [
        "How Lookout picked $245,000 (their range: $235,000 – $250,000)",
        "• Top quarter of their range ($245,000). You start high, and they still have room to come down to a number you'd take.",
        "• Your target, if it's inside their range. It's your number, and they can afford it.",
        "• Never below your floor ($220,000) or above their max ($250,000). Your walk-away number isn't your ask, and asking over budget gets you screened out.",
        "• Minimum question: still answered inside their range. Naming less than they budgeted leaves money on the table.",
      ].join("\n"),
    );
  });
});
