import { describe, expect, it } from "vitest";
import { findForHash, hashFor, stepSelection } from "./findSelection";

describe("stepSelection", () => {
  const ids = ["a", "b", "c"];

  it("moves down and up one find at a time", () => {
    expect(stepSelection(ids, "a", 1)).toBe("b");
    expect(stepSelection(ids, "c", -1)).toBe("b");
  });

  it("stays put at either end", () => {
    expect(stepSelection(ids, "c", 1)).toBe("c");
    expect(stepSelection(ids, "a", -1)).toBe("a");
  });

  it("starts at the top going down and the bottom going up when nothing is selected", () => {
    expect(stepSelection(ids, null, 1)).toBe("a");
    expect(stepSelection(ids, null, -1)).toBe("c");
  });

  it("treats a selection that is filtered out of view as no selection", () => {
    expect(stepSelection(ids, "gone", 1)).toBe("a");
    expect(stepSelection(ids, "gone", -1)).toBe("c");
  });

  it("has nothing to select on an empty board", () => {
    expect(stepSelection([], "a", 1)).toBeNull();
    expect(stepSelection([], null, -1)).toBeNull();
  });
});

describe("hashFor and findForHash", () => {
  const finds = [
    { id: "1", company: "Acme", role: "Design Lead" },
    { id: "2", company: "Bolt & Co.", role: "Staff Engineer, UI" },
  ];

  it("writes the find's slug, or nothing when none is selected", () => {
    expect(hashFor(finds[0])).toBe("#acme-design-lead");
    expect(hashFor(finds[1])).toBe("#bolt-co-staff-engineer-ui");
    expect(hashFor(null)).toBe("");
  });

  it("reads back the find it wrote", () => {
    for (const f of finds) expect(findForHash(hashFor(f), finds)).toBe(f);
  });

  it("reads a hash with or without the #, and percent-encoded", () => {
    expect(findForHash("acme-design-lead", finds)).toBe(finds[0]);
    expect(findForHash("#acme%2Ddesign%2Dlead", finds)).toBe(finds[0]);
  });

  it("finds nothing for an empty, unknown or malformed hash", () => {
    expect(findForHash("", finds)).toBeUndefined();
    expect(findForHash("#", finds)).toBeUndefined();
    expect(findForHash("#nobody-here", finds)).toBeUndefined();
    expect(findForHash("#%E0%A4%A", finds)).toBeUndefined();
  });
});
