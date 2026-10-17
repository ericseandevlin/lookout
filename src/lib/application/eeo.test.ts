import { describe, expect, it } from "vitest";
import { classify, DECLINE, matchOption, resolve } from "./eeo";
import { answerKey } from "./saved";

// Real option lists from Greenhouse boards (Attentive, CLEAR, Understood), 2026-10-17.
const attentiveGender = ["Female", "Male", "Nonbinary", "Decline to self-identify"];
const clearGender = ["Man", "Non-binary", "Woman", "I prefer to self-describe", "I don't wish to answer"];
const eeocGender = ["Decline To Self Identify", "Female", "Male"];
const clearVeteran = ["Yes, I am a veteran or active member", "No, I am not a veteran or active member", "I prefer to self-describe", "I don't wish to answer"];
const eeocVeteran = ["I don't wish to answer", "I identify as one or more of the classifications of protected veteran", "I am not a protected veteran"];
const clearRace = ["Black or of African descent", "East Asian", "Hispanic, Latinx or of Spanish Origin", "White", "I don't wish to answer"];

describe("classify", () => {
  it("reads the category from the form's wording", () => {
    expect(classify("How would you describe your gender identity? (mark all that apply)")).toBe("gender");
    expect(classify("Do you identify as transgender?")).toBe("transgender");
    expect(classify("VeteranStatus")).toBe("veteran");
    expect(classify("Are you a veteran or active member of the United States Armed Forces?")).toBe("veteran");
    expect(classify("How would you describe your racial/ethnic background?")).toBe("race");
    expect(classify("Do you have a disability or chronic condition?")).toBe("disability");
    expect(classify("Why do you want this job?")).toBeNull();
  });
});

describe("matchOption", () => {
  it("matches the same answer across different wordings", () => {
    expect(matchOption("Man", attentiveGender)).toBe("Male");
    expect(matchOption("Man", clearGender)).toBe("Man");
    expect(matchOption("Woman", eeocGender)).toBe("Female");
    expect(matchOption("Non-binary", attentiveGender)).toBe("Nonbinary");
  });

  it("finds the decline option however it's worded", () => {
    expect(matchOption(DECLINE, attentiveGender)).toBe("Decline to self-identify");
    expect(matchOption(DECLINE, clearGender)).toBe("I don't wish to answer");
    expect(matchOption(DECLINE, eeocGender)).toBe("Decline To Self Identify");
  });

  it("never mixes up veteran and not a veteran", () => {
    expect(matchOption("Not a veteran", clearVeteran)).toBe("No, I am not a veteran or active member");
    expect(matchOption("Veteran", clearVeteran)).toBe("Yes, I am a veteran or active member");
    expect(matchOption("Not a veteran", eeocVeteran)).toBe("I am not a protected veteran");
    expect(matchOption("Veteran", eeocVeteran)).toBe("I identify as one or more of the classifications of protected veteran");
  });

  it("returns nothing rather than guess", () => {
    expect(matchOption("Asian", clearRace)).toBe("East Asian");
    expect(matchOption("Middle Eastern or North African", clearRace)).toBeNull();
  });
});

describe("resolve", () => {
  const q = "How would you describe your racial/ethnic background?";
  it("prefers the answer the person picked for this exact wording", () => {
    const p = { answers: { race: "Asian" }, exact: { [answerKey(q)]: "White" } };
    expect(resolve(p, q, clearRace)).toBe("White");
  });

  it("falls back to the category answer, and to nothing", () => {
    expect(resolve({ answers: { gender: "Woman" }, exact: {} }, "Gender", eeocGender)).toBe("Female");
    expect(resolve({ answers: {}, exact: {} }, "Gender", eeocGender)).toBeNull();
  });
});
