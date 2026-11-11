import { describe, expect, it } from "vitest";
import { findPay, money } from "./pay";

describe("money", () => {
  it("reads common formats", () => {
    expect(money("$224,000")).toBe(224000);
    expect(money("224K")).toBe(224000);
    expect(money("$ 185000")).toBe(185000);
  });
});

describe("findPay", () => {
  it("reads Greenhouse pay_ranges even when the page text is long", () => {
    const html = `<html><title>Director</title>${"<p>filler</p>".repeat(3000)}<script>window.x={"pay_ranges":[{"title":"Base Compensation Range","description":"x","min":"$224,000","max":"$308,000","currency_type":"USD"}]}</script></html>`;
    expect(findPay(html)).toMatchObject({ min: 224000, max: 308000, currency: "USD", source: "pay range" });
  });

  it("prefers schema.org baseSalary and annualizes hourly", () => {
    const ld = { "@type": "JobPosting", baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { minValue: 60, maxValue: 80, unitText: "HOUR" } } };
    const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    expect(findPay(html)).toMatchObject({ min: 124800, max: 166400, source: "structured data" });
  });

  it.each([
    ["a plain number value", { value: 150000, unitText: "YEAR" }, 150000, 150000],
    ["min and max on the MonetaryAmount", { minValue: 140000, maxValue: 170000 }, 140000, 170000],
    ["formatted strings", { value: { minValue: "120,000", maxValue: "$150,000", unitText: "YEAR" } }, 120000, 150000],
    ["an hourly plain number", { value: 60, unitText: "HOUR" }, 124800, 124800],
  ])("reads baseSalary with %s (#647)", (_, salary, min, max) => {
    const ld = { "@type": "JobPosting", baseSalary: { "@type": "MonetaryAmount", currency: "USD", ...salary } };
    // Text pay that differs, so a pass proves the structured data was read.
    const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script><p>$10,000 - $20,000</p>`;
    expect(findPay(html)).toMatchObject({ min, max, source: "structured data" });
  });

  it("finds a range in plain text, with or without the second $", () => {
    expect(findPay("", "Base Compensation Range $224,000 - $308,000 USD")).toMatchObject({ min: 224000, max: 308000 });
    expect(findPay("", "Salary: $180K to 220K per year")).toMatchObject({ min: 180000, max: 220000 });
    expect(findPay("", "Pay: $55.50 - $70/hr")).toMatchObject({ min: 115440, max: 145600 });
  });

  it.each([
    ["$40 - $55 an hour", 83200, 114400],
    ["$40 - $55 per hour", 83200, 114400],
    ["$40 - $55 /h", 83200, 114400],
    ["$40 - $55 hourly", 83200, 114400],
    ["$8,000 - $10,000 a month", 96000, 120000],
    ["$8,000 - $10,000/month", 96000, 120000],
    ["$1,500 - $2,000 per week", 78000, 104000],
    ["$1,500 - $2,000/wk", 78000, 104000],
    ["$1,500 - $2,000 weekly", 78000, 104000],
  ])("reads the unit in %s (#484)", (text, min, max) => {
    expect(findPay("", text)).toMatchObject({ min, max });
  });

  it.each([
    ["$2,500 - $3,000 bi-weekly", 65000, 78000],
    ["$2,500 - $3,000 biweekly", 65000, 78000],
    ["$2,500 - $3,000 paid every two weeks", 65000, 78000],
  ])("reads %s as 26 pay periods, not weekly (#708)", (text, min, max) => {
    expect(findPay("", text)).toMatchObject({ min, max });
  });

  it.each([
    ["$4,000 - $5,000 semi-monthly", 96000, 120000],
    ["$4,000 - $5,000 semimonthly", 96000, 120000],
    ["$4,000 - $5,000 paid twice a month", 96000, 120000],
  ])("reads %s as 24 pay periods, not monthly (#714)", (text, min, max) => {
    expect(findPay("", text)).toMatchObject({ min, max });
  });

  it("keeps a stated year over a pay schedule, and doesn't read /hybrid as hourly", () => {
    expect(findPay("", "$120,000 - $140,000 per year, paid monthly")).toMatchObject({ min: 120000, max: 140000 });
    expect(findPay("", "$120,000 - $140,000 a year, paid bi-weekly")).toMatchObject({ min: 120000, max: 140000 });
    expect(findPay("", "$120,000 - $140,000 annually")).toMatchObject({ min: 120000, max: 140000 });
    expect(findPay("", "$120,000 - $140,000 / hybrid in NYC")).toMatchObject({ min: 120000, max: 140000 });
  });

  it.each([
    ["$60,000 - $70,000 (paid bi-weekly)", 60000, 70000],
    ["$100,000 - $120,000, paid monthly", 100000, 120000],
    ["$150,000 - $180,000 + equity, health benefits paid monthly", 150000, 180000],
    ["$90,000 - $110,000, paid every two weeks", 90000, 110000],
  ])("keeps %s yearly: a pay schedule is not the unit (#716)", (text, min, max) => {
    expect(findPay("", text)).toMatchObject({ min, max });
  });

  it("still reads a per-paycheck range by its schedule (#716)", () => {
    expect(findPay("", "$2,000 - $2,500 paid bi-weekly")).toMatchObject({ min: 52000, max: 65000 });
    expect(findPay("", "$40 - $50/hr, paid weekly")).toMatchObject({ min: 83200, max: 104000 });
  });

  it.each([
    ["Salary: $150,000 - $180,000. Hybrid, 3 days a week in the office.", 150000, 180000],
    ["$120,000 - $150,000 for 40 hours per week", 120000, 150000],
    ["$130,000 - $160,000, in office two days a week", 130000, 160000],
    ["$40 - $50 per hour, 40 hours a week", 83200, 104000],
  ])("reads %s by its pay unit: a work week is not the unit (#732)", (text, min, max) => {
    expect(findPay("", text)).toMatchObject({ min, max });
  });

  it("still reads a weekly range as weekly (#732)", () => {
    expect(findPay("", "$2,000 - $2,500 per week")).toMatchObject({ min: 104000, max: 130000 });
  });

  it.each([
    ["$150,000 - $200,000 ($72-$96/hr)", 150000, 200000],
    ["$150,000 - $200,000 (about $72 - $96 an hour)", 150000, 200000],
    ["$120,000 - $140,000, or $5,000 - $6,000 a month for contractors", 120000, 140000],
  ])("reads %s by its own unit, not a later range's (#746)", (text, min, max) => {
    expect(findPay("", text)).toMatchObject({ min, max });
  });

  it("keeps an hourly range hourly when a yearly word follows it (#646)", () => {
    expect(findPay("", "$25.00 - $35.00 per hour, plus an annual bonus")).toMatchObject({ min: 52000, max: 72800 });
    expect(findPay("", "$40 - $55/hr. Eligible for yearly raises")).toMatchObject({ min: 83200, max: 114400 });
  });

  it.each([
    ["$150-200K", 150000, 200000],
    ["$150 - $200K per year", 150000, 200000],
    ["$95/hr - $110/hr", 197600, 228800],
    ["$95/hour - $110/hour", 197600, 228800],
    ["$95 an hour - $110 an hour", 197600, 228800],
    ["$8,000/month - $10,000/month", 96000, 120000],
  ])("reads %s (#682)", (text, min, max) => {
    expect(findPay("", `Pay: ${text}. Benefits included.`)).toMatchObject({ min, max });
  });

  it.each([
    ["The salary for this role is between $150,000 and $180,000 annually.", 150000, 180000, "USD"],
    ["Base pay range: US$120,000 - US$150,000", 120000, 150000, "USD"],
    ["$120,000 USD - $150,000 USD", 120000, 150000, "USD"],
    ["CA$120,000 - CA$150,000", 120000, 150000, "CAD"],
    ["A$140,000 - A$160,000", 140000, 160000, "AUD"],
    ["$110,000 CAD - $130,000 CAD", 110000, 130000, "CAD"],
  ])("reads %s (#686)", (text, min, max, currency) => {
    expect(findPay("", text)).toEqual({ min, max, currency, source: "text" });
  });

  it.each([
    ["CAD $120,000 - $150,000", "CAD"],
    ["Salary: CAD$120,000 - CAD$150,000", "CAD"],
    ["AUD $120,000 - $150,000", "AUD"],
    ["USD $120,000 - $150,000", "USD"],
    ["Earn a $120,000 - $150,000 salary", "USD"],
  ])("reads the code before the dollar sign in %s (#709)", (text, currency) => {
    expect(findPay("", text)).toEqual({ min: 120000, max: 150000, currency, source: "text" });
  });

  it('joins with "and" only after "between", and keeps page order (#686)', () => {
    expect(findPay("", "A $5,000 signing bonus and $10,000 relocation")).toBeNull();
    expect(findPay("", "Get $5,000 and $120,000 - $150,000 base")).toMatchObject({ min: 120000, max: 150000 });
    expect(findPay("", "Pay is $130,000 - $160,000. Offers are between $140,000 and $150,000.")).toMatchObject({ min: 130000, max: 160000 });
  });

  it("ignores amounts that aren't a salary range", () => {
    expect(findPay("", "We raised $50,000,000 in 2024 and serve 2,000 - 3,000 customers")).toBeNull();
    expect(findPay("", "401k match up to $5,000 - $6,000")).toBeNull();
  });

  it("reads pay from raw HTML: entities decoded, scripts skipped (#742)", () => {
    const pay = { min: 150000, max: 200000, currency: "USD", source: "text" };
    expect(findPay("<p>Pay: $150,000&ndash;$200,000 per year</p>")).toEqual(pay);
    expect(findPay("<p>Pay: &#36;150,000 - &#x24;200,000</p>")).toEqual(pay);
    expect(findPay('<script>var x = {"a": "$1,000 - $2,000 a month"}</script><p>Pay: $150,000 - $200,000</p>')).toEqual(pay);
  });
});
