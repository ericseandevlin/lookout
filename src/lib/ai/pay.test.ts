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

  it("keeps a stated year over a pay schedule, and doesn't read /hybrid as hourly", () => {
    expect(findPay("", "$120,000 - $140,000 per year, paid monthly")).toMatchObject({ min: 120000, max: 140000 });
    expect(findPay("", "$120,000 - $140,000 annually")).toMatchObject({ min: 120000, max: 140000 });
    expect(findPay("", "$120,000 - $140,000 / hybrid in NYC")).toMatchObject({ min: 120000, max: 140000 });
  });

  it("ignores amounts that aren't a salary range", () => {
    expect(findPay("", "We raised $50,000,000 in 2024 and serve 2,000 - 3,000 customers")).toBeNull();
    expect(findPay("", "401k match up to $5,000 - $6,000")).toBeNull();
  });
});
