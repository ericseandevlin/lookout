import { describe, expect, it } from "vitest";
import { needsConsent, versionDate } from "./legal";

describe("needsConsent (#21)", () => {
  it("asks accounts that never agreed", () => {
    expect(needsConsent({ termsVersion: null, privacyVersion: null }, null, "2026-11-07")).toBe(true);
  });

  it("passes once the current privacy version is agreed, while there are no Terms", () => {
    expect(needsConsent({ termsVersion: null, privacyVersion: "2026-11-07" }, null, "2026-11-07")).toBe(false);
  });

  it("asks again when the privacy version changes", () => {
    expect(needsConsent({ termsVersion: null, privacyVersion: "2026-11-07" }, null, "2026-12-01")).toBe(true);
  });

  it("asks again when Terms appear or change", () => {
    expect(needsConsent({ termsVersion: null, privacyVersion: "p1" }, "t1", "p1")).toBe(true);
    expect(needsConsent({ termsVersion: "t1", privacyVersion: "p1" }, "t2", "p1")).toBe(true);
    expect(needsConsent({ termsVersion: "t1", privacyVersion: "p1" }, "t1", "p1")).toBe(false);
  });
});

describe("versionDate", () => {
  it("reads as a date, with no time zone drift", () => {
    expect(versionDate("2026-11-07")).toBe("November 7, 2026");
  });
});
