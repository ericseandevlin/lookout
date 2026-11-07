import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compText, initialsOf, isNewFind, postedDays, postedText, slugOf } from "./board";
import type { Find } from "./types";

const find = (over: Partial<Find> = {}) =>
  ({ company: "Acme", role: "Design Lead", comp: null, postedAt: null, archived: false, seen: false, addedAt: "2026-11-07T12:00:00Z", ...over }) as Find;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("postedDays and postedText", () => {
  it("has no date when the posting has none", () => {
    expect(postedDays(find())).toBeNull();
    expect(postedText(find())).toBe("no date");
  });

  it("counts days, then weeks, then months", () => {
    expect(postedText(find({ postedAt: "2026-11-07" }))).toBe("today");
    expect(postedText(find({ postedAt: "2026-11-04" }))).toBe("3d ago");
    expect(postedText(find({ postedAt: "2026-10-24" }))).toBe("2w ago");
    expect(postedText(find({ postedAt: "2026-09-08" }))).toBe("2mo ago");
  });

  it("treats a future date as today", () => {
    expect(postedDays(find({ postedAt: "2026-11-20" }))).toBe(0);
    expect(postedText(find({ postedAt: "2026-11-20" }))).toBe("today");
  });
});

describe("isNewFind", () => {
  it("is new inside the window when unseen and not archived", () => {
    expect(isNewFind(find({ addedAt: "2026-11-05T12:00:00Z" }), 3)).toBe(true);
  });

  it("is not new outside the window", () => {
    expect(isNewFind(find({ addedAt: "2026-11-01T12:00:00Z" }), 3)).toBe(false);
  });

  it("is not new once seen or archived", () => {
    expect(isNewFind(find({ seen: true }), 3)).toBe(false);
    expect(isNewFind(find({ archived: true }), 3)).toBe(false);
  });
});

describe("slugOf", () => {
  it("joins company and role into a lowercase slug", () => {
    expect(slugOf(find({ company: "Acme, Inc.", role: "Sr. UX Engineer (Remote)" }))).toBe("acme-inc-sr-ux-engineer-remote");
  });
});

describe("initialsOf", () => {
  it("takes the first and last word", () => {
    expect(initialsOf("ada")).toBe("A");
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("  ada  king   lovelace ")).toBe("AL");
  });

  it("falls back to a question mark", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});

describe("compText", () => {
  it("formats a range or says none was posted", () => {
    expect(compText(find({ comp: [150000, 210000] }))).toBe("$150,000 – $210,000");
    expect(compText(find())).toBe("No comp posted");
  });
});
