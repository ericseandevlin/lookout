import { describe, expect, it } from "vitest";
import { doneStep, noNewBody, whyNoneAdded } from "./runOutcome";

const tally = (t: Partial<{ postings: number; known: number; dealbreaker: number; belowFloor: number; added: number }>) => ({ postings: 0, known: 0, dealbreaker: 0, belowFloor: 0, added: 0, ...t });

describe("doneStep (#862)", () => {
  it("counts what was added", () => {
    expect(doneStep(tally({ postings: 3, added: 1 }))).toBe("Added 1 new find");
    expect(doneStep(tally({ postings: 3, added: 2, known: 1 }))).toBe("Added 2 new finds");
  });

  it("says nothing matched when no postings were read", () => {
    expect(doneStep(tally({}))).toBe("No matching open roles this time");
    // Every result already on the board, skipped before reading (#1125).
    expect(doneStep(tally({ known: 2 }))).toBe("No new finds this time. Everything matching is already on your board");
  });

  it("says already on your board only when they all are", () => {
    expect(doneStep(tally({ postings: 2, known: 2 }))).toBe("No new finds this time. Everything matching is already on your board");
  });

  it("names the floor and dealbreakers when those kept postings off", () => {
    expect(doneStep(tally({ postings: 3, belowFloor: 3 }))).toBe("No new finds this time: 3 under your pay floor");
    expect(doneStep(tally({ postings: 4, known: 1, dealbreaker: 1, belowFloor: 2 }))).toBe("No new finds this time: 1 already on your board, 1 hit a dealbreaker, 2 under your pay floor");
  });
});

describe("noNewBody (#862)", () => {
  it("keeps the old line for runs without a tally, or where every posting is known", () => {
    expect(noNewBody(2, null)).toBe("Lookout read 2 matching postings, and they're already on your board. It'll look again on your schedule.");
    expect(noNewBody(1, tally({ postings: 1, known: 1 }))).toBe("Lookout read 1 matching posting, and it's already on your board. It'll look again on your schedule.");
  });

  it("says why when postings were left off", () => {
    expect(noNewBody(3, tally({ postings: 3, dealbreaker: 1, belowFloor: 2 }))).toBe("Lookout read 3 matching postings and added none: 1 hit a dealbreaker, 2 under your pay floor. It'll look again on your schedule.");
  });

  it("lists nothing for empty counts", () => {
    expect(whyNoneAdded(tally({}))).toEqual([]);
  });
});

describe("noNewBody with nothing read (#1125)", () => {
  it("says everything the search turned up is already on the board", () => {
    expect(noNewBody(0, tally({ known: 3 }))).toBe("Everything the search turned up is already on your board. It'll look again on your schedule.");
  });
});

describe("board results skipped before reading don't hide cuts (#1138)", () => {
  // 3 results already on the board were skipped, 2 pages read, both hit a dealbreaker.
  const t = tally({ postings: 2, known: 3, dealbreaker: 2 });
  it("doneStep names the dealbreakers", () => {
    expect(doneStep(t)).toBe("No new finds this time: 3 already on your board, 2 hit a dealbreaker");
  });
  it("noNewBody names the dealbreakers", () => {
    expect(noNewBody(2, t)).toBe("Lookout read 2 matching postings and added none: 3 already on your board, 2 hit a dealbreaker. It'll look again on your schedule.");
  });
  it("all known with nothing cut keeps the short line", () => {
    expect(doneStep(tally({ postings: 2, known: 5 }))).toBe("No new finds this time. Everything matching is already on your board");
  });
});
