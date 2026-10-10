import { describe, expect, it } from "vitest";
import { buildTips, emptyTally } from "./report";

const longQ1 = "Director of Digital Product or Head of Design Engineering at an AI-first product company in New York";
const profile = { answers: { q1: longQ1, q5: "No agencies, no crypto", floor: "$220K" }, hasResume: true, floor: "$220K" };
const run = (tally: Partial<ReturnType<typeof emptyTally>>, extra: { results?: number; picked?: number; read?: number } = {}) => ({
  results: 40,
  picked: 12,
  read: 10,
  ...extra,
  tally: { ...emptyTally(), ...tally },
});

describe("buildTips", () => {
  it("blames the reader, not the profile, when no page could be opened", () => {
    const tips = buildTips(run({}, { read: 0 }), profile);
    expect(tips).toHaveLength(1);
    expect(tips[0].text).toMatch(/on our end/);
    expect(tips[0].href).toBeUndefined();
  });

  it("points empty searches at the first answer", () => {
    const tips = buildTips(run({}, { results: 0, picked: 0, read: 0 }), profile);
    expect(tips[0].href).toBe("/profile#q-q1");
  });

  it("names dealbreaker and floor cuts with links to those fields", () => {
    const tips = buildTips(run({ postings: 8, dealbreaker: 2, belowFloor: 3 }), profile);
    expect(tips.map((t) => t.href)).toEqual(["/profile#q-q5", "/profile#q-comp"]);
    expect(tips[0].text).toContain("No agencies, no crypto");
    expect(tips[1].text).toContain("$220K");
  });

  it("caps at two tips and never links the same field twice", () => {
    const tips = buildTips(run({ postings: 9, belowFloor: 3, offLocation: 3 }, { results: 0 }), { ...profile, answers: { q1: "PM" }, hasResume: false });
    expect(tips).toHaveLength(2);
    expect(new Set(tips.map((t) => t.href)).size).toBe(2);
  });

  it("says nothing when the search went fine", () => {
    expect(buildTips(run({ postings: 6, added: 5, known: 1 }), profile)).toEqual([]);
  });
});
