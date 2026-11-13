import { describe, expect, it } from "vitest";
import { classify, DECLINE, matchOption, resolve } from "./eeo";
import { answerKey } from "./saved";

// Real option lists from Greenhouse boards (Attentive, CLEAR, Understood), 2026-10-17.
const attentiveGender = ["Female", "Male", "Nonbinary", "Decline to self-identify"];
const clearGender = ["Man", "Non-binary", "Woman", "I prefer to self-describe", "I don't wish to answer"];
const eeocGender = ["Decline To Self Identify", "Female", "Male"];
const clearVeteran = ["Yes, I am a veteran or active member", "No, I am not a veteran or active member", "I prefer to self-describe", "I don't wish to answer"];
const eeocVeteran = ["I don't wish to answer", "I identify as one or more of the classifications of protected veteran", "I am not a protected veteran"];
// Workday race list (alphabetical, "Not Hispanic" on each race) and the federal CC-305 disability form (#662).
const workdayRace = [
  "American Indian or Alaska Native (Not Hispanic or Latino) (United States of America)",
  "Asian (Not Hispanic or Latino) (United States of America)",
  "Black or African American (Not Hispanic or Latino) (United States of America)",
  "Hispanic or Latino (United States of America)",
  "White (Not Hispanic or Latino) (United States of America)",
  "I do not wish to answer. (United States of America)",
];
const cc305 = ["Yes, I have a disability, or have had one in the past", "No, I do not have a disability and have not had one in the past", "I do not want to answer"];
const clearRace = ["Black or of African descent", "East Asian", "Hispanic, Latinx or of Spanish Origin", "White", "I don't wish to answer"];

describe("classify", () => {
  it("reads the category from the form's wording", () => {
    expect(classify("How would you describe your gender identity? (mark all that apply)")).toBe("gender");
    expect(classify("Do you identify as transgender?")).toBe("transgender");
    // Transgender as an example in a gender question is the gender question (#929).
    expect(classify("Gender identity (e.g. woman, man, non-binary, transgender)")).toBe("gender");
    expect(classify("What is your gender, such as woman, man, transgender or non-binary?")).toBe("gender");
    expect(classify("Do you identify as transgender? (optional)")).toBe("transgender");
    expect(classify("VeteranStatus")).toBe("veteran");
    expect(classify("Are you a veteran or active member of the United States Armed Forces?")).toBe("veteran");
    expect(classify("How would you describe your racial/ethnic background?")).toBe("race");
    expect(classify("Do you have a disability or chronic condition?")).toBe("disability");
    expect(classify("Why do you want this job?")).toBeNull();
  });

  it("reads a bare Sex question as gender, and Sexual orientation as orientation (#816)", () => {
    expect(classify("Sex")).toBe("gender");
    expect(classify("Sex *")).toBe("gender");
    expect(classify("Sexual Orientation")).toBe("orientation");
  });

  it("leaves an LGBTQ+ question and a military-spouse question unclassified (#909)", () => {
    expect(classify("Do you identify as LGBTQ+ (lesbian, gay, bisexual, transgender, queer or another identity)?")).toBeNull();
    expect(classify("Do you identify as a member of the LGBTQIA+ community?")).toBeNull();
    expect(classify("Are you a military spouse?")).toBeNull();
    expect(classify("Are you the spouse or dependent of an active duty military member?")).toBeNull();
    expect(classify("Do you identify as transgender?")).toBe("transgender");
    expect(classify("What is your sexual orientation? (e.g. gay, lesbian, bisexual)")).toBe("orientation");
    expect(classify("Protected veteran status")).toBe("veteran");
  });
});

describe("matchOption", () => {
  it("matches the same answer across different wordings", () => {
    expect(matchOption("Man", attentiveGender)).toBe("Male");
    expect(matchOption("Man", clearGender)).toBe("Man");
    expect(matchOption("Woman", eeocGender)).toBe("Female");
    expect(matchOption("Non-binary", attentiveGender)).toBe("Nonbinary");
  });

  it("matches cisgender wordings, never a transgender option (#816)", () => {
    const cis = ["Transgender woman", "Transgender man", "Cisgender woman", "Cisgender man", "Non-binary", "Prefer not to say"];
    expect(matchOption("Woman", cis)).toBe("Cisgender woman");
    expect(matchOption("Man", cis)).toBe("Cisgender man");
    expect(matchOption("Man", ["Cis Woman", "Cis Man", "Decline"])).toBe("Cis Man");
    expect(matchOption("Woman", ["Cis-female", "Cis-male"])).toBe("Cis-female");
    expect(matchOption("Man", ["Transgender man", "Decline"])).toBeNull();
  });

  it("finds the decline option however it's worded", () => {
    expect(matchOption(DECLINE, attentiveGender)).toBe("Decline to self-identify");
    expect(matchOption(DECLINE, clearGender)).toBe("I don't wish to answer");
    expect(matchOption(DECLINE, eeocGender)).toBe("Decline To Self Identify");
  });

  it.each(["Prefer to not answer", "I choose to not disclose", "Wish to not answer", "No answer", "Opt out", "Undisclosed", "Not specified"])(
    "finds %s as the decline, and never as No (#754)",
    (o) => {
      expect(matchOption(DECLINE, ["Yes", "No", o])).toBe(o);
      expect(matchOption("No", [o, "Yes", "No"])).toBe("No");
    },
  );

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

describe("matchOption on Workday and federal forms (#662)", () => {
  it("never gives a Hispanic person a Not Hispanic option", () => {
    expect(matchOption("Hispanic or Latino", workdayRace)).toBe("Hispanic or Latino (United States of America)");
    expect(matchOption("White", workdayRace)).toBe("White (Not Hispanic or Latino) (United States of America)");
    expect(matchOption(DECLINE, workdayRace)).toBe("I do not wish to answer. (United States of America)");
  });

  it("never says Not Hispanic for someone whose profile says Hispanic, whatever their race (#1024)", () => {
    const p = (race: string, hispanic: string) => ({ answers: { race, hispanic }, exact: {} });
    expect(resolve(p("White", "Yes"), "Race/Ethnicity", workdayRace)).toBeNull();
    expect(resolve(p("Asian", "Yes"), "Race/Ethnicity", workdayRace)).toBeNull();
    expect(resolve(p("Hispanic or Latino", "Yes"), "Race/Ethnicity", workdayRace)).toBe("Hispanic or Latino (United States of America)");
    expect(resolve(p(DECLINE, "Yes"), "Race/Ethnicity", workdayRace)).toBe("I do not wish to answer. (United States of America)");
    // A plain race list is unaffected, and Hispanic No still gets the combined option.
    expect(resolve(p("White", "Yes"), "Race", clearRace)).toBe("White");
    expect(resolve(p("White", "No"), "Race/Ethnicity", workdayRace)).toBe("White (Not Hispanic or Latino) (United States of America)");
  });

  it("reads Asian as a word, not inside Caucasian", () => {
    expect(matchOption("Asian", ["White/Caucasian", "Asian", "Decline to self-identify"])).toBe("Asian");
    expect(matchOption("Asian", ["Caucasian", "Black"])).toBeNull();
  });

  it("finds the CC-305 decline and keeps No on the real No", () => {
    expect(matchOption(DECLINE, cc305)).toBe("I do not want to answer");
    expect(matchOption("No", cc305)).toBe("No, I do not have a disability and have not had one in the past");
    expect(matchOption("Yes", cc305)).toBe("Yes, I have a disability, or have had one in the past");
  });

  it("answers a Hispanic question worded without yes or no", () => {
    const opts = ["Hispanic or Latino", "Not Hispanic or Latino", "Decline to self-identify"];
    expect(matchOption("Yes", opts)).toBe("Hispanic or Latino");
    expect(matchOption("No", opts)).toBe("Not Hispanic or Latino");
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

  it("answers an ethnicity question with Hispanic options from the Hispanic answer (#805)", () => {
    const p = { answers: { race: "White", hispanic: "No" }, exact: {} };
    expect(resolve(p, "Ethnicity", ["Hispanic or Latino", "Not Hispanic or Latino", "Decline to self-identify"])).toBe("Not Hispanic or Latino");
    expect(resolve(p, "Ethnicity: are you Hispanic or Latino?", ["Yes", "No", "I don't wish to answer"])).toBe("No");
    // A race list that names Hispanic among the races stays the race question.
    expect(resolve(p, "Race/Ethnicity", ["Hispanic or Latino", "White (Not Hispanic or Latino)", "Asian (Not Hispanic or Latino)"])).toBe("White (Not Hispanic or Latino)");
    expect(resolve(p, "How would you describe your racial/ethnic background?", clearRace)).toBe("White");
  });
});

describe("a race answer that fits several options is asked (#954)", () => {
  // Greenhouse's demographic race question, full list.
  const ghRace = ["Black or of African descent", "East Asian", "Hispanic, Latinx or of Spanish Origin", "Indigenous or Native American", "Middle Eastern or North African", "Native Hawaiian or Pacific Islander", "South Asian", "Southeast Asian", "White or European", "I prefer to self-describe", "I don't wish to answer"];
  it("does not guess East Asian for Asian", () => {
    expect(matchOption("Asian", ghRace)).toBeNull();
    expect(resolve({ answers: { race: "Asian" }, exact: {} }, "How would you describe your racial/ethnic background?", ghRace)).toBeNull();
  });
  it("still matches a race with one option on the same list", () => {
    expect(matchOption("White", ghRace)).toBe("White or European");
    expect(matchOption("Black or African American", ghRace)).toBe("Black or of African descent");
  });
  it("still matches Asian when the list has one Asian option", () => {
    expect(matchOption("Asian", ["Asian", "White", "Decline to self-identify"])).toBe("Asian");
  });
});

describe("a disability question that mentions veterans (#973)", () => {
  it("is classed and answered as disability", () => {
    const q = "Do you have a disability or a history of one? Veterans with service-connected disabilities should also answer here.";
    expect(classify(q)).toBe("disability");
    expect(classify("Are you a protected veteran? This includes disabled veterans.")).toBe("veteran");
    expect(classify("Disabled veteran status")).toBe("veteran");
    expect(resolve({ answers: { disability: "Yes", veteran: "Not a veteran" }, exact: {} }, q, cc305)).toBe(cc305[0]);
  });
});

describe("a non-veteran never gets a veteran's answer (#961)", () => {
  it("skips \"I am a veteran, but not a protected veteran\" listed first", () => {
    const opts = ["I am a veteran, but not a protected veteran", "I am not a veteran", "I identify as one or more of the classifications of protected veteran", "I do not wish to self-identify"];
    expect(matchOption("Not a veteran", opts)).toBe("I am not a veteran");
  });

  it("skips \"I identify as a veteran, just not a protected veteran\" listed first (#1003)", () => {
    const opts = ["I identify as a veteran, just not a protected veteran", "I am not a veteran", "I identify as one or more of the classifications of protected veteran", "I don't wish to answer"];
    expect(matchOption("Not a veteran", opts)).toBe("I am not a veteran");
  });
});

