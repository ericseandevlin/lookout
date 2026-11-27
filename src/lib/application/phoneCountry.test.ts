import { describe, expect, it } from "vitest";
import { DIAL, countryOption, phoneCountry, phoneCountryOf } from "./phoneCountry";

describe("phoneCountry (#1794)", () => {
  it.each([
    ["+44 20 7946 0958", "United Kingdom"],
    ["+49 30 123456", "Germany"],
    ["0041 44 668 18 00", "Switzerland"],
    ["+353 1 234 5678", "Ireland"],
    ["+852 2123 4567", "Hong Kong"],
    ["+86 10 1234 5678", "China"],
    ["+(61) 2 9876 5432", "Australia"],
    ["+1 415 555 0100", "United States"],
    ["+1-416-555-0100", "United States"],
    // A label or bracket first, or a full-width plus (#1819).
    ["(+44) 20 7946 0958", "United Kingdom"],
    ["(0049) 30 1234567", "Germany"],
    ["Tel: +49 30 1234567", "Germany"],
    ["UK +44 7700 900123", "United Kingdom"],
    ["[+33] 1 23 45 67 89", "France"],
    ["＋44 20 7946 0958", "United Kingdom"],
  ])("%s dials from %s", (phone, country) => {
    expect(phoneCountry(phone)).toBe(country);
  });

  it.each(["(415) 555-0100", "555-0100", "020 7946 0958", "", null, undefined, "+999 123", "call me", "Tel: (415) 555-0100", "Mobile 020 7946 0958"])("%s has no code it knows, so United States", (phone) => {
    expect(phoneCountry(phone)).toBe("United States");
  });

  it("reads the first Phone step among the fill steps", () => {
    expect(phoneCountryOf([{ prompt: "Email", content: "+44 x" }, { prompt: "Phone number", content: "+49 30 123456" }])).toBe("Germany");
    expect(phoneCountryOf([{ prompt: "Email", content: "a@b.co" }])).toBe("United States");
  });

  it("an option is the country, with or without its code, never a longer name", () => {
    const us = countryOption("United States");
    expect(us.test("United States")).toBe(true);
    expect(us.test("United States +1")).toBe(true);
    expect(us.test("United States Minor Outlying Islands")).toBe(false);
    expect(countryOption("United Kingdom").test(" United Kingdom (+44)")).toBe(true);
    expect(countryOption("United Kingdom").test("United States")).toBe(false);
  });
});

describe("more dial codes (#1876)", () => {
  it.each([
    ["+51 1 234 5678", "Peru"],
    ["+212 6 12 34 56 78", "Morocco"],
    ["+880 1712 345678", "Bangladesh"],
    ["+506 2222 3333", "Costa Rica"],
    ["+961 1 234 567", "Lebanon"],
    ["+995 32 212 3456", "Georgia"],
    ["00593 2 234 5678", "Ecuador"],
    ["+58 212 555 1234", "Venezuela"],
    // Codes that matched before still do.
    ["+351 21 123 4567", "Portugal"],
    ["+34 91 123 4567", "Spain"],
    ["+7 495 123 4567", "Russia"],
  ])("%s dials from %s", (phone, country) => {
    expect(phoneCountry(phone)).toBe(country);
  });

  it("no code is the start of another, so the longest match is the only one", () => {
    const codes = Object.keys(DIAL);
    for (const a of codes) for (const b of codes) if (a !== b) expect(b.startsWith(a), `${a} starts ${b}`).toBe(false);
  });
});
