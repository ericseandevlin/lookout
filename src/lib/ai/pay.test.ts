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

  it("reads Greenhouse pay_ranges in euros with European separators (#962)", () => {
    const html = `<html><script>window.x={"pay_ranges":[{"title":"Salary","description":"x","min":"€36.000","max":"€45.000","currency_type":"EUR"}]}</script></html>`;
    expect(findPay(html)).toMatchObject({ min: 36000, max: 45000, currency: "EUR", source: "pay range" });
  });

  it("reads Greenhouse pay_ranges in pounds with British separators (#962)", () => {
    const html = `<html><script>window.x={"pay_ranges":[{"title":"Salary","description":"x","min":"£60,000","max":"£70,000","currency_type":"GBP"}]}</script></html>`;
    expect(findPay(html)).toMatchObject({ min: 60000, max: 70000, currency: "GBP", source: "pay range" });
  });

  it("prefers schema.org baseSalary and annualizes hourly", () => {
    const ld = { "@type": "JobPosting", baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { minValue: 60, maxValue: 80, unitText: "HOUR" } } };
    const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    expect(findPay(html)).toMatchObject({ min: 124800, max: 166400, source: "structured data" });
  });

  it.each([
    ["usd", "USD"],
    [" US$ ", "USD"],
    ["$", "USD"],
    ["eur", "EUR"],
    ["£", "GBP"],
    ["<b>GBP</b>", "USD"],
    [42, "USD"],
  ])("reads a structured-data currency %j as %s (#1130)", (currency, want) => {
    const ld = { "@type": "JobPosting", baseSalary: { currency, value: { minValue: 150000, maxValue: 180000, unitText: "YEAR" } } };
    expect(findPay(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)?.currency).toBe(want);
  });

  it("reads salaryCurrency on the posting when baseSalary has none (#1130)", () => {
    const ld = { "@type": "JobPosting", salaryCurrency: "cad", baseSalary: { value: { minValue: 150000, maxValue: 180000, unitText: "YEAR" } } };
    expect(findPay(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)?.currency).toBe("CAD");
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

  it("takes the JobPosting's salaryCurrency when baseSalary names none (#905)", () => {
    const ld = { "@type": "JobPosting", salaryCurrency: "CAD", baseSalary: { value: { minValue: 100000, maxValue: 130000, unitText: "YEAR" } } };
    const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    expect(findPay(html)).toMatchObject({ min: 100000, max: 130000, currency: "CAD", source: "structured data" });
  });

  it("reads a baseSalary list, skipping entries it can't use (#850)", () => {
    const ld = {
      "@type": "JobPosting",
      baseSalary: [
        { "@type": "MonetaryAmount", currency: "USD", value: { minValue: "n/a", unitText: "YEAR" } },
        { "@type": "MonetaryAmount", currency: "USD", value: { minValue: 140000, maxValue: 180000, unitText: "YEAR" } },
        { "@type": "MonetaryAmount", currency: "USD", value: { minValue: 120000, maxValue: 150000, unitText: "YEAR" } },
      ],
    };
    const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script><p>$10,000 - $20,000</p>`;
    expect(findPay(html)).toMatchObject({ min: 140000, max: 180000, source: "structured data" });
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

  it.each([
    ["Salary: $95,000 - $115,000 plus a monthly wellness stipend", 95000, 115000],
    ["Base pay $120,000 - $140,000 + monthly phone stipend", 120000, 140000],
    ["Compensation: $150,000 - $180,000, hybrid 3x a week in NYC", 150000, 180000],
    ["$130,000 - $150,000 and monthly team offsites", 130000, 150000],
    ["$110,000 - $125,000 with an hourly on-call stipend", 110000, 125000],
  ])("keeps %s yearly: a unit further along the line is about something else (#881)", (text, min, max) => {
    expect(findPay("", text)).toMatchObject({ min, max });
  });

  it.each([
    ["$8,000 - $10,000 plus benefits, per month", 96000, 120000],
    ["$40 - $55 depending on experience, hourly", 83200, 114400],
    ["$2,500 - $3,000 USD per week", 130000, 156000],
  ])("still reads %s by a unit later in the line when the range isn't a year's pay (#881)", (text, min, max) => {
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

  it.each([
    ["$60 - $70 per hr", 124800, 145600],
    ["$60 - $70 an hr", 124800, 145600],
    ["$8,000 - $10,000 per mo", 96000, 120000],
    ["$2,000 - $2,500 per wk", 104000, 130000],
    ["$150,000 - $200,000 per yr, paid monthly", 150000, 200000],
  ])("reads the short unit in %s (#752)", (text, min, max) => {
    expect(findPay("", text)).toMatchObject({ min, max });
  });

  it.each([
    ["USD 150,000 - 200,000", 150000, 200000, "USD"],
    ["Salary range: CAD 120,000 to 140,000 per year", 120000, 140000, "CAD"],
    ["Pay is between USD 150k and 180k", 150000, 180000, "USD"],
    ["USD 60 - 70 per hour", 124800, 145600, "USD"],
  ])("reads %s, led by a code with no $ (#753)", (text, min, max, currency) => {
    expect(findPay("", text)).toMatchObject({ min, max, currency });
  });

  it("still skips a bare number range with no $ or code (#753)", () => {
    expect(findPay("", "Team of 120,000 - 150,000 users")).toBeNull();
  });

  it.each([
    ["Hiring range 180,000 USD - 220,000 USD", 180000, 220000, "USD"],
    ["Salary range: 180,000-220,000 USD", 180000, 220000, "USD"],
    ["Base pay: 180K - 220K USD", 180000, 220000, "USD"],
    ["180,000 - 220,000 CAD per year", 180000, 220000, "CAD"],
    ["Pay is between 150,000 and 180,000 AUD", 150000, 180000, "AUD"],
    ["60 - 70 USD per hour", 124800, 145600, "USD"],
  ])("reads %s, with the code only after the numbers (#809)", (text, min, max, currency) => {
    expect(findPay("", text)).toMatchObject({ min, max, currency });
  });

  it("keeps the $ range first when a code-trailed range follows it (#809)", () => {
    expect(findPay("", "$150,000 - $200,000. Canada: 140,000 - 190,000 CAD")).toMatchObject({ min: 150000, max: 200000 });
  });

  it.each([
    ["$150,000 - $200,000. Canada: 140,000 - 190,000 CAD"],
    ["$150,000 - $200,000 (US); 140,000 - 190,000 AUD (Sydney)"],
    ["$150,000 - $200,000, or 120,000 - 160,000 GBP in London"],
  ])("keeps %s in USD when another currency's range follows (#811)", (text) => {
    expect(findPay("", text)).toMatchObject({ min: 150000, max: 200000, currency: "USD" });
  });

  it("still reads a code right after the range (#811)", () => {
    expect(findPay("", "$150,000 - $200,000 CAD per year")).toMatchObject({ currency: "CAD" });
    expect(findPay("", "$150,000 - $200,000 a year (AUD), plus super")).toMatchObject({ currency: "AUD" });
  });

  it.each([
    ["$150,000 - $180,000 SGD per year", "SGD"],
    ["$120,000 - $150,000 NZD", "NZD"],
    ["S$150,000 - S$180,000", "SGD"],
    ["NZ$120,000 - NZ$150,000", "NZD"],
    ["HK$800,000 - HK$1,000,000", "HKD"],
    ["$150,000 - $180,000 USD", "USD"],
    ["$150,000 - $180,000 plus equity", "USD"],
  ])("reads the currency of %s as %s (#883)", (text, currency) => {
    expect(findPay("", text)).toMatchObject({ currency });
  });

  it.each([
    ["Salary: SGD $120,000 - $150,000 per annum", 120000, 150000, "SGD"],
    ["NZD $110,000 - $130,000", 110000, 130000, "NZD"],
    ["HKD $600,000 - $800,000", 600000, 800000, "HKD"],
    ["Salary: AU$140,000 – AU$170,000", 140000, 170000, "AUD"],
    ["MX$900,000 - MX$1,100,000 per year", 900000, 1100000, "MXN"],
    ["SGD 120,000 - 150,000", 120000, 150000, "SGD"],
    ["180,000 - 220,000 NZD", 180000, 220000, "NZD"],
    ["CAD $120,000 - $150,000", 120000, 150000, "CAD"],
  ])("reads %s in its own currency (#905)", (text, min, max, currency) => {
    expect(findPay("", text)).toMatchObject({ min, max, currency });
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

  it("reads the unit from the label before a range (#945)", () => {
    const t = (text: string) => findPay("", text);
    expect(t("Hourly rate: $45.00 - $55.00")).toMatchObject({ min: 93600, max: 114400 });
    expect(t("Hourly pay range: $30 - $40")).toMatchObject({ min: 62400, max: 83200 });
    expect(t("Monthly salary: $8,000 - $10,000")).toMatchObject({ min: 96000, max: 120000 });
    expect(t("Hourly Pay Range\n$60 - $75 USD")).toMatchObject({ min: 124800, max: 156000 });
    // A yearly-looking range keeps its own reading; the label is only a fallback.
    expect(t("Hourly employees welcome. Salary: $120,000 - $150,000")).toMatchObject({ min: 120000, max: 150000 });
    // A label far up the page or a pay schedule is not the unit.
    expect(t("Paid monthly.\n\nRange: $45 - $55")).toBeNull();
  });
  it("reads a range in pounds or euros from the page text (#1186)", () => {
    const t = (text: string) => findPay("", text);
    expect(t("Salary: £60,000 - £70,000 per annum")).toEqual({ min: 60000, max: 70000, currency: "GBP", source: "text" });
    expect(t("€50k – €60k plus bonus")).toMatchObject({ min: 50000, max: 60000, currency: "EUR" });
    expect(t("between £55,000 and £65,000")).toMatchObject({ min: 55000, max: 65000, currency: "GBP" });
    expect(findPay("<p>Pay: &pound;60,000 &ndash; &pound;70,000</p>")).toMatchObject({ min: 60000, max: 70000, currency: "GBP" });
    // A dollar range still reads as dollars.
    expect(t("$150,000 - $180,000")).toMatchObject({ currency: "USD" });
  });

  it("reads a day rate as 260 working days (#1187)", () => {
    const t = (text: string) => findPay("", text);
    expect(t("Pay: $600 - $800 per day")).toEqual({ min: 156000, max: 208000, currency: "USD", source: "text" });
    expect(t("$650/day - $750/day, 6 month contract")).toMatchObject({ min: 169000, max: 195000 });
    expect(t("Day rate: $500 - $700")).toMatchObject({ min: 130000, max: 182000 });
    // Hours worked a day are not the unit.
    expect(t("$70 - $90 per hour, 8 hours a day")).toMatchObject({ min: 145600, max: 187200 });
    expect(t("$150,000 - $180,000, in the office one day a week")).toMatchObject({ min: 150000, max: 180000 });
    const ld = { "@type": "JobPosting", baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { minValue: 600, maxValue: 800, unitText: "DAY" } } };
    expect(findPay(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)).toMatchObject({ min: 156000, max: 208000, source: "structured data" });
  });
});
