import { describe, expect, it } from "vitest";
import { answerKey, isCommon, match, savedBlock, upsert } from "./saved";

describe("saved answers", () => {
  it("keeps common facts, never salary or essays", () => {
    expect(isCommon("Are you currently legally authorized to work in the United States?", "Yes")).toBe(true);
    expect(isCommon("Zip / Postal", "10001")).toBe(true);
    expect(isCommon("Will you now or in the future require sponsorship?", "No")).toBe(true);
    expect(isCommon("What is your desired base salary?", "$220,000")).toBe(false);
    expect(isCommon("Why do you want to work here?", "Because")).toBe(false);
    expect(isCommon("Zip / Postal", "")).toBe(false);
    expect(isCommon("Preferred First Name", "Bob")).toBe(true);
    expect(isCommon("Preferred name", "Bob")).toBe(true);
    expect(isCommon("Preferred pronouns", "he/him")).toBe(true);
    expect(isCommon("Who referred you?", "Jane Doe")).toBe(false);
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

  it("keeps a No about one employer, never a Yes or a referrer's name (#1032)", () => {
    expect(isCommon("Have you previously worked for this company?", "No")).toBe(true);
    expect(isCommon("Have you previously worked for this company?", "Yes")).toBe(false);
    expect(isCommon("Were you referred by a current employee? If so, please list their name.", "Jane Doe")).toBe(false);
    expect(isCommon("Were you referred by a current employee?", "No, I was not")).toBe(true);
  });

  it("keeps a relative start date, never a calendar date (#1032)", () => {
    expect(isCommon("Earliest start date", "2 weeks after an offer")).toBe(true);
    for (const a of ["12/1", "2026-12-01", "Dec 1, 2026", "May 4"]) expect(isCommon("Earliest start date", a)).toBe(false);
  });

  it("never reuses an older saved Yes about one employer (#1032)", () => {
    const old = [{ key: answerKey("Have you previously worked for this company?"), question: "Have you previously worked for this company?", answer: "Yes", updatedAt: "2026-11-01T00:00:00Z" }];
    expect(match(old, "Have you previously worked for this company?")).toBeNull();
    expect(savedBlock(old)).toBe("");
    expect(savedBlock(upsert(old, "Zip / Postal", "10001"))).toContain("Zip / Postal: 10001");
  });

  it("replaces an older answer to the same question", () => {
    const list = upsert(upsert([], "Zip / Postal", "10001"), "Zip/Postal", "11211");
    expect(list).toHaveLength(1);
    expect(list[0].answer).toBe("11211");
  });
});
