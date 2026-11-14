import { describe, expect, it } from "vitest";
import { answerKey, isCommon, match, savedBlock, upsert } from "./saved";

describe("saved answers", () => {
  it("keeps common facts, never salary or essays", () => {
    expect(isCommon("Are you currently legally authorized to work in the United States?", "Yes")).toBe(true);
    expect(isCommon("Zip / Postal", "10001")).toBe(true);
    expect(isCommon("Will you now or in the future require sponsorship?", "No")).toBe(true);
    // #1123: "for this role" doesn't make work authorization role-specific; "this location" still can.
    expect(isCommon("Are you legally authorized to work in the United States for this position?", "Yes")).toBe(true);
    expect(isCommon("Will you now or in the future require visa sponsorship for this role?", "No")).toBe(true);
    expect(isCommon("Will you require sponsorship to work in this location?", "No")).toBe(false);
    expect(isCommon("Are you willing to relocate for this role?", "Yes")).toBe(false);
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

  it("keeps a general answer to how they heard of the job, never a referral (#1097)", () => {
    expect(isCommon("How did you hear about this job?", "LinkedIn")).toBe(true);
    expect(isCommon("How did you hear about us?", "Company website")).toBe(true);
    for (const a of ["Referred by Jane Doe (Design Manager)", "Employee Referral", "A friend who works there", "Recruiter reached out", "Former colleague on the team"])
      expect(isCommon("How did you hear about this job?", a)).toBe(false);
    // Saved before the fix: never reused or shown to the model.
    const old = [{ key: answerKey("How did you hear about us?"), question: "How did you hear about us?", answer: "Employee Referral", updatedAt: "" }];
    expect(match(old, "How did you hear about us?", ["LinkedIn", "Employee Referral"])).toBeNull();
    expect(savedBlock(old)).toBe("");
  });

  it("keeps a relative start date, never a calendar date (#1032)", () => {
    expect(isCommon("Earliest start date", "2 weeks after an offer")).toBe(true);
    for (const a of ["12/1", "2026-12-01", "Dec 1, 2026", "May 4"]) expect(isCommon("Earliest start date", a)).toBe(false);
  });

  it("spots every common way of writing a calendar start date (#1079)", () => {
    for (const a of ["June 1st", "Dec 1st", "1st December", "15 January 2027", "January 2027", "December 2026", "the week of Jan 5th", "May 2027", "4th of May", "Sept. 8"])
      expect(isCommon("Earliest start date", a)).toBe(false);
    for (const a of ["Immediately", "2 weeks after an offer", "After a final decision, with 30 days notice", "1 month", "I may need 3 weeks"])
      expect(isCommon("When can you start?", a)).toBe(true);
  });

  it("never reuses an older saved Yes about one employer (#1032)", () => {
    const old = [{ key: answerKey("Have you previously worked for this company?"), question: "Have you previously worked for this company?", answer: "Yes", updatedAt: "2026-11-01T00:00:00Z" }];
    expect(match(old, "Have you previously worked for this company?")).toBeNull();
    expect(savedBlock(old)).toBe("");
    expect(savedBlock(upsert(old, "Zip / Postal", "10001"))).toContain("Zip / Postal: 10001");
  });

  it("never reuses an answer for a different country or region in parentheses (#1089)", () => {
    const us = upsert([], "Are you legally authorized to work in the country (United States)?", "Yes");
    expect(match(us, "Are you legally authorized to work in the country (United Kingdom)?", ["Yes", "No"])).toBeNull();
    expect(match(us, "Are you legally authorized to work in the country (United States)?", ["Yes", "No"])).toBe("Yes");
    const visa = upsert([], "Will you require visa sponsorship? (US roles)", "No");
    expect(match(visa, "Will you require visa sponsorship? (UK roles)")).toBeNull();
    // A field marker in parentheses still matches the plain question.
    const zip = upsert([], "Zip / Postal", "10001");
    expect(match(zip, "Zip / Postal (required)")).toBe("10001");
    expect(match(upsert([], "Phone (optional)", "555"), "Phone")).toBe("555");
  });

  it("replaces an older answer to the same question", () => {
    const list = upsert(upsert([], "Zip / Postal", "10001"), "Zip/Postal", "11211");
    expect(list).toHaveLength(1);
    expect(list[0].answer).toBe("11211");
  });
  it("matches whole words and never keeps self-identification (#1059)", () => {
    for (const q of ["What is your ethnicity?", "Ethnicity", "Gender", "Are you a protected veteran?", "Do you identify as Hispanic or Latino?", "Race"])
      expect(isCommon(q, "Asian")).toBe(false);
    expect(isCommon("Are you at least 18 years of age?", "Yes")).toBe(true);
    expect(isCommon("How many years of experience do you have?", "10")).toBe(false);
    expect(isCommon("City", "Brooklyn")).toBe(true);
    const old = [{ key: answerKey("What is your ethnicity?"), question: "What is your ethnicity?", answer: "Asian", updatedAt: "2026-11-01T00:00:00Z" }];
    expect(savedBlock(old)).toBe("");
    expect(match(old, "What is your ethnicity?")).toBeNull();
  });
});
