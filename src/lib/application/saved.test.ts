import { describe, expect, it } from "vitest";
import { answerKey, isCommon, match, upsert } from "./saved";

describe("saved answers", () => {
  it("keeps common facts, never salary or essays", () => {
    expect(isCommon("Are you currently legally authorized to work in the United States?", "Yes")).toBe(true);
    expect(isCommon("Zip / Postal", "10001")).toBe(true);
    expect(isCommon("Will you now or in the future require sponsorship?", "No")).toBe(true);
    expect(isCommon("What is your desired base salary?", "$220,000")).toBe(false);
    expect(isCommon("Why do you want to work here?", "Because")).toBe(false);
    expect(isCommon("Zip / Postal", "")).toBe(false);
    expect(isCommon("This role is to be based out of the location listed in the job description. Are you able to commute?", "Yes")).toBe(false);
  });

  it("matches the same question worded with different punctuation", () => {
    const list = upsert([], "Zip / Postal", "10001");
    expect(answerKey("Zip/Postal*")).toBe(answerKey("Zip / Postal"));
    expect(match(list, "Zip/Postal")).toBe("10001");
    expect(match(list, "Phone")).toBeNull();
  });

  it("only reuses a choice that the form offers, in its spelling", () => {
    const list = upsert([], "Are you authorized to work in the US?", "yes");
    expect(match(list, "Are you authorized to work in the US?", ["Yes", "No"])).toBe("Yes");
    expect(match(list, "Are you authorized to work in the US?", ["Authorized", "Not authorized"])).toBeNull();
  });

  it("replaces an older answer to the same question", () => {
    const list = upsert(upsert([], "Zip / Postal", "10001"), "Zip/Postal", "11211");
    expect(list).toHaveLength(1);
    expect(list[0].answer).toBe("11211");
  });
});
