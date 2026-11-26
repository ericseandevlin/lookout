import { describe, expect, it } from "vitest";
import { countryOption, phoneCountry, phoneCountryOf } from "./phoneCountry";

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
  ])("%s dials from %s", (phone, country) => {
    expect(phoneCountry(phone)).toBe(country);
  });

  it.each(["(415) 555-0100", "555-0100", "020 7946 0958", "", null, undefined, "+999 123", "call me"])("%s has no code it knows, so United States", (phone) => {
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
