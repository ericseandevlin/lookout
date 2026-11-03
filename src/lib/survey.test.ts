import { describe, expect, it } from "vitest";
import { answersCsv, cleanAnswer, cleanOptions, isDue } from "./survey";

describe("isDue", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("asks someone who was never asked", () => expect(isDue(null, 5, now)).toBe(true));
  it("waits N days after the last answer or skip", () => {
    expect(isDue(new Date("2026-11-06T12:00:00Z"), 5, now)).toBe(false);
    expect(isDue(new Date("2026-11-05T12:00:00Z"), 5, now)).toBe(true);
  });
});

describe("cleanAnswer", () => {
  const choice = { kind: "choice" as const, options: ["Yes", "No"] };
  it("keeps a valid choice, scale value or text", () => {
    expect(cleanAnswer(choice, " Yes ")).toBe("Yes");
    expect(cleanAnswer({ kind: "scale", options: [] }, "4")).toBe("4");
    expect(cleanAnswer({ kind: "text", options: [] }, "  more filters  ")).toBe("more filters");
  });
  it("null is a skip", () => expect(cleanAnswer(choice, null)).toBeNull());
  it("refuses anything outside the question", () => {
    expect(() => cleanAnswer(choice, "Maybe")).toThrow();
    expect(() => cleanAnswer({ kind: "scale", options: [] }, "6")).toThrow();
    expect(() => cleanAnswer({ kind: "text", options: [] }, "   ")).toThrow();
  });
  it("caps text", () => expect(cleanAnswer({ kind: "text", options: [] }, "x".repeat(5000))!.length).toBe(1000));
});

describe("cleanOptions", () => {
  it("one per line, no blanks or repeats", () => expect(cleanOptions("choice", ["A", " ", "B", "A"])).toEqual(["A", "B"]));
  it("needs two choices", () => expect(() => cleanOptions("choice", ["Only"])).toThrow());
  it("is empty for scale and text", () => expect(cleanOptions("scale", ["A", "B"])).toEqual([]));
});

describe("answersCsv", () => {
  it("quotes commas and quotes, marks skips, and defuses formulas", () => {
    const csv = answersCsv("How's it going?", [
      { email: "a@x.com", name: "Ann, B", answer: 'Good "mostly"', at: new Date("2026-11-01T00:00:00Z") },
      { email: "b@x.com", name: "Bo", answer: null, at: new Date("2026-11-02T00:00:00Z") },
      { email: "c@x.com", name: "Cy", answer: "=HYPERLINK(1)", at: new Date("2026-11-03T00:00:00Z") },
    ]).split("\r\n");
    expect(csv[0]).toBe("question,email,name,answer,skipped,answered_at");
    expect(csv[1]).toBe('How\'s it going?,a@x.com,"Ann, B","Good ""mostly""",no,2026-11-01T00:00:00.000Z');
    expect(csv[2]).toBe("How's it going?,b@x.com,Bo,,yes,2026-11-02T00:00:00.000Z");
    expect(csv[3]).toContain(`"'=HYPERLINK(1)"`);
  });
});
