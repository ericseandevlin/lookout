import { describe, expect, it } from "vitest";
import { needsConsent, versionDate } from "./legal";

describe("needsConsent (#21)", () => {
  it("asks accounts that never agreed", () => {
    expect(needsConsent({ termsVersion: null, privacyVersion: null }, "t1", "p1")).toBe(true);
  });

  it("asks again when the privacy version changes", () => {
    expect(needsConsent({ termsVersion: "t1", privacyVersion: "p1" }, "t1", "p2")).toBe(true);
  });

  it("asks accounts that agreed before Terms existed, and again when Terms change (#20)", () => {
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
