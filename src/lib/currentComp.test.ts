import { describe, expect, it } from "vitest";
import { compareComp, compareText, parseCurrentComp } from "./currentComp";

// Synthetic numbers only (#109 privacy note): none of these are anyone's real pay.
describe("parseCurrentComp", () => {
  it("reads plain, formatted and k amounts", () => {
    expect(parseCurrentComp("100000")).toBe(100000);
    expect(parseCurrentComp("$100,000")).toBe(100000);
    expect(parseCurrentComp(" 100k ")).toBe(100000);
    expect(parseCurrentComp("97.5K")).toBe(97500);
  });

  it("refuses ranges, words and out-of-range amounts", () => {
    for (const s of ["", "abc", "100-120k", "$100k+", "0", "500", "20000000"]) expect(parseCurrentComp(s)).toBeNull();
  });
});

describe("compareComp", () => {
  it("says range not stated when a posting has none, with no estimate", () => {
    const c = compareComp(null, "USD", 100000);
    expect(c).toEqual({ kind: "not-stated" });
    expect(compareText(c)).toBe("Range not stated");
  });

  it("puts the low end against the saved number when the whole range is above", () => {
    const c = compareComp([110000, 130000], "USD", 100000);
    expect(c).toEqual({ kind: "above", pct: 10 });
    expect(compareText(c)).toBe("Starts 10% above your current pay");
  });

  it("puts the high end against the saved number when the whole range is below", () => {
    const c = compareComp([70000, 90000], "USD", 100000);
    expect(c).toEqual({ kind: "below", pct: 10 });
    expect(compareText(c)).toBe("Tops out 10% below your current pay");
  });

  it("calls it inside when the saved number is in the range, ends included", () => {
    expect(compareComp([90000, 110000], "USD", 100000).kind).toBe("within");
    expect(compareComp([100000, 120000], "USD", 100000).kind).toBe("within");
    expect(compareComp([80000, 100000], "USD", 100000).kind).toBe("within");
  });

  it("handles a single-number posting and reversed ends", () => {
    expect(compareComp([105000, 105000], "USD", 100000)).toEqual({ kind: "above", pct: 5 });
    expect(compareComp([130000, 110000], "USD", 100000)).toEqual({ kind: "above", pct: 10 });
  });

  it("does not convert currencies", () => {
    const c = compareComp([110000, 130000], "CAD", 100000);
    expect(c).toEqual({ kind: "other-currency", currency: "CAD" });
    expect(compareText(c)).toBe("Range in CAD, not compared");
  });

  it("does not round a small gap to a misleading 0%", () => {
    expect(compareText(compareComp([100200, 120000], "USD", 100000))).toBe("Starts just above your current pay");
  });
});
