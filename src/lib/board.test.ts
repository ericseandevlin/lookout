import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attrNum, attrStr, cellQuiet, cellText, compText, daysUntil, dueText, initialsOf, isNewFind, postedDays, postedText, scoreStyle, slugOf, stageStyle, valueText } from "./board";
import type { Find } from "./types";
import { color } from "@/lib/tokens";

const find = (over: Partial<Find> = {}) =>
  ({ company: "Acme", role: "Design Lead", comp: null, postedAt: null, archived: false, seen: false, addedAt: "2026-11-07T12:00:00Z", ...over }) as Find;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Local noon: dates without a time read as local noon, so a UTC clock broke these outside UTC (#405).
  vi.setSystemTime(new Date(2026, 10, 7, 12));
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
    expect(postedText(find({ postedAt: "2026-09-01" }))).toBe("2mo ago");
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

// Kind-driven cells (#8), tested in #405.
describe("RFP cells", () => {
  const rfp = (attributes: Record<string, unknown>, over: Partial<Find> = {}) => find({ type: "rfp", attributes, location: "", ...over });

  it("reads attributes by type", () => {
    const f = rfp({ agency: "  City of Austin ", value: 250000, nan: Number.NaN, flag: true });
    expect(attrStr(f, "agency")).toBe("City of Austin");
    expect(attrStr(f, "value")).toBe("250000");
    expect(attrStr(f, "flag")).toBe("");
    expect(attrStr(f, "missing")).toBe("");
    expect(attrNum(f, "value")).toBe(250000);
    expect(attrNum(f, "nan")).toBeNull();
    expect(attrNum(f, "agency")).toBeNull();
    expect(attrStr(find({ attributes: undefined as unknown as Find["attributes"] }), "x")).toBe("");
  });

  it("formats a value from a number, digits, or free text", () => {
    expect(valueText(rfp({ value: 250000 }))).toBe("$250,000");
    expect(valueText(rfp({ value: "250000" }))).toBe("$250,000");
    expect(valueText(rfp({ value: "$2.5M over 3 years" }))).toBe("$2.5M over 3 years");
    expect(valueText(rfp({}))).toBe("No value posted");
    expect(valueText(rfp({ value: "  " }))).toBe("No value posted");
  });

  it("counts days to a date, or null when there isn't one", () => {
    expect(daysUntil("2026-11-10")).toBe(3);
    expect(daysUntil("2026-11-07")).toBe(0);
    expect(daysUntil("2026-11-05")).toBe(-2);
    expect(daysUntil("")).toBeNull();
    expect(daysUntil("next Tuesday")).toBeNull();
    expect(daysUntil("2026-11-10", new Date(2026, 10, 9, 12).getTime())).toBe(1);
  });

  it("counts calendar days whatever the hour or a clock change (#495)", () => {
    const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
    expect(daysUntil("2026-11-07", at(7, 9))).toBe(0);
    expect(daysUntil("2026-11-07", at(7, 23))).toBe(0);
    expect(daysUntil("2026-11-08", at(7, 0))).toBe(1);
    expect(daysUntil("2026-11-08", at(7, 23))).toBe(1);
    expect(daysUntil("2026-11-06", at(7, 1))).toBe(-1);
    // Nov 1 2026 is the fall-back change in the US.
    expect(daysUntil("2026-11-01", new Date(2026, 9, 31, 12).getTime())).toBe(1);
    expect(daysUntil("2026-11-02", new Date(2026, 9, 31, 8).getTime())).toBe(2);
    expect(daysUntil("2026-02-30")).toBe(daysUntil("2026-03-02"));
  });

  it("says how long is left, how long it's been, or what was posted", () => {
    expect(dueText(rfp({ due: "2026-11-21" }))).toBe("14d left");
    expect(dueText(rfp({ due: "2026-11-07" }))).toBe("today");
    expect(dueText(rfp({ due: "2026-11-04" }))).toBe("3d past");
    expect(dueText(rfp({ due: "When funded" }))).toBe("When funded");
    expect(dueText(rfp({}))).toBe("no date");
  });

  it("fills each board column", () => {
    const f = rfp({ value: 90000, due: "2026-11-10", setAside: "8(a)" }, { company: "Austin", role: "Website redesign", comp: [100, 200], postedAt: "2026-11-04", location: "Austin, TX" });
    expect(cellText(f, "company")).toBe("Austin");
    expect(cellText(f, "role")).toBe("Website redesign");
    expect(cellText(f, "comp")).toBe("$100 – $200");
    expect(cellText(f, "listed")).toBe("3d ago");
    expect(cellText(f, "location")).toBe("Austin, TX");
    expect(cellText(f, "value")).toBe("$90,000");
    expect(cellText(f, "due")).toBe("3d left");
    expect(cellText(f, "setAside")).toBe("8(a)");
    expect(cellText(f, "unknown")).toBe("");
    expect(cellText(rfp({}), "location")).toBe("\u2014");
    expect(cellText(rfp({}), "setAside")).toBe("\u2014");
  });

  it("dims every column that has nothing stated, and only those", () => {
    const keys = ["comp", "listed", "value", "due", "setAside", "location", "company", "role"];
    const empty = rfp({});
    const full = rfp({ value: 1, due: "2026-12-01", setAside: "SDVOSB" }, { comp: [1, 2], postedAt: "2026-11-01", location: "Remote" });
    expect(keys.filter((k) => cellQuiet(empty, k))).toEqual(["comp", "listed", "value", "due", "setAside", "location"]);
    expect(keys.filter((k) => cellQuiet(full, k))).toEqual([]);
  });
});

describe("stageStyle and scoreStyle", () => {
  it("styles known stages and falls back to neutral", () => {
    expect(stageStyle("Offer")).toEqual({ bg: "#E6EDD9", ink: color.greenText });
    expect(stageStyle("Awarded")).toEqual(stageStyle("Offer"));
    expect(stageStyle("Something new")).toEqual({ bg: color.border, ink: "#5E574D" });
  });

  it("fills 5s, tints 4s, outlines the rest", () => {
    expect(scoreStyle(5).bg).toBe("#99220F");
    expect(scoreStyle(6).bg).toBe("#99220F");
    expect(scoreStyle(4).bg).toBe("#F8A865");
    expect(scoreStyle(3)).toEqual({ bg: "#fff", ink: "#1D1A0F", border: "#D8D0C4" });
  });
});
