import { describe, expect, it } from "vitest";
import { choose, notesBlock, removeNote, upsertNote } from "./skills";

describe("experience notes", () => {
  it("adds, replaces and removes by skill, case-insensitive", () => {
    let l = upsertNote([], "AI fluency", "Built Claude agents for my job search");
    l = upsertNote(l, "ai fluency", "Daily Claude Code user; built a VPS code worker");
    expect(l).toHaveLength(1);
    expect(l[0].story).toMatch(/VPS/);
    expect(removeNote(l, "AI Fluency")).toEqual([]);
  });

  it("renders notes as facts for the model", () => {
    expect(notesBlock([])).toBe("");
    expect(notesBlock(upsertNote([], "SQL", ""))).toContain("SQL (they say they have this; no details given)");
  });
});

describe("keyword choices", () => {
  it("toggles include, exclude and reset", () => {
    let c = choose(undefined, "AI fluency", "include");
    c = choose(c, "KPIs", "exclude");
    expect(c).toEqual({ include: ["AI fluency"], exclude: ["KPIs"] });
    c = choose(c, "kpis", "include");
    expect(c).toEqual({ include: ["AI fluency", "kpis"], exclude: [] });
    expect(choose(c, "AI Fluency", "reset").include).toEqual(["kpis"]);
  });
});
