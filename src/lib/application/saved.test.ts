import { describe, expect, it } from "vitest";
import { onlyThisOne, answerKey, isCommon, match, savedBlock, upsert } from "./saved";

describe("saved answers", () => {
  it("keeps common facts, never salary or essays", () => {
    expect(isCommon("Are you currently legally authorized to work in the United States?", "Yes")).toBe(true);
    expect(isCommon("Zip / Postal", "10001")).toBe(true);
    expect(isCommon("Will you now or in the future require sponsorship?", "No")).toBe(true);
    // #1123: "for this role" doesn't make work authorization role-specific; "this location" still can.
    expect(isCommon("Are you legally authorized to work in the United States for this position?", "Yes")).toBe(true);
    expect(isCommon("Will you now or in the future require visa sponsorship for this role?", "No")).toBe(true);
    expect(isCommon("Are you legally authorized to work in the United States?", "Yes")).toBe(true);
    expect(isCommon("What country are you applying from?", "United States")).toBe(true);
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
    // The form's own spelling of the saved answer (#1524).
    expect(match([...list, { key: answerKey("Employment type"), question: "Employment type", answer: "Full time", updatedAt: "" }], "Employment type", ["Full-time", "Part-time"])).toBe("Full-time");
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
    // "This position" and "this role" are the same question as "this job" (#1545).
    expect(isCommon("How did you hear about this position?", "LinkedIn")).toBe(true);
    expect(isCommon("How did you hear about this role?", "Indeed")).toBe(true);
    expect(isCommon("How did you hear about this opportunity?", "Company website")).toBe(true);
    expect(isCommon("How did you hear about this role?", "Employee referral")).toBe(false);
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

  it("keeps a span of weeks, which is not a day and month (#1575)", () => {
    for (const a of ["2-3 weeks after an offer", "4-6 weeks", "2-4 business days", "1-2 months notice", "2/3 weeks", "4.6 weeks"]) {
      expect(isCommon("What is your earliest start date?", a), a).toBe(true);
      expect(onlyThisOne("When can you start?", a), a).toBe(false);
    }
    for (const a of ["12/1", "12-1", "1/15/2027", "12/1, then 2 weeks of onboarding"]) expect(isCommon("Earliest start date", a), a).toBe(false);
  });

  it("keeps a start day named from the day it was written with one application (#1845)", () => {
    for (const a of ["Next Monday", "This Friday", "Tomorrow", "End of Q1", "Q2", "After the holidays", "Right after Thanksgiving", "Next month", "End of the year", "Early next year", "Summer 2027"]) {
      expect(isCommon("When can you start?", a), a).toBe(false);
      expect(onlyThisOne("Earliest start date", a), a).toBe(true);
    }
    // Spans and plain availability still travel.
    for (const a of ["Immediately", "ASAP", "2 weeks after an offer", "1 month", "One month's notice", "4-6 weeks"]) expect(isCommon("When can you start?", a), a).toBe(true);
    // Only start questions: a phone answer that holds "Q1" is unchanged.
    expect(onlyThisOne("Phone", "Q1 Monday")).toBe(false);
  });

  it("keeps a notice period that names a day with one application (#1852)", () => {
    for (const [q, a] of [["What is your notice period?", "Ends January 31"], ["Notice period", "Until 15/12"], ["What is your notice period?", "My last day is Friday"], ["How much notice do you need to give?", "Until the end of the month"]]) {
      expect(isCommon(q, a), a).toBe(false);
      expect(onlyThisOne(q, a), a).toBe(true);
    }
    // A length of notice still travels.
    for (const a of ["2 weeks", "1 month", "One month's notice", "1-2 months", "90 days", "None"]) expect(isCommon("What is your notice period?", a), a).toBe(true);
  });

  it("keeps the age check however it is worded (#1576)", () => {
    for (const q of ["Are you 18 or older?", "Are you over 18?", "Are you at least 18?", "Are you 18+?", "Are you 18 years of age or older?", "Are you 18 and over?"])
      expect(isCommon(q, "Yes"), q).toBe(true);
    expect(isCommon("Do you have 18 or more years of experience?", "Yes")).toBe(false);
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

describe("saved answers that depend on where the job is (#1227)", () => {
  it("never keeps a sponsorship or work permit answer asked for the job's own country", () => {
    expect(isCommon("Will you now or in the future require sponsorship to work in the country where this role is based?", "No")).toBe(false);
    expect(isCommon("Are you legally authorized to work in the country where this job is located?", "Yes")).toBe(false);
    expect(isCommon("Do you have the right to work in the position's country?", "Yes")).toBe(false);
  });
  it("never keeps one asked for the country you are applying to (#1572)", () => {
    for (const q of [
      "Are you legally authorized to work in the country for which you are applying?",
      "Are you legally authorized to work in the country in which you are applying?",
      "Will you now or in the future require sponsorship to work in the country you are applying to?",
      "Are you authorized to work in the country you're applying for?",
      "Are you legally authorized to work in the location of this role?",
      "Do you require visa sponsorship to work in the country of this position?",
    ]) {
      expect(isCommon(q, "Yes"), q).toBe(false);
      expect(match(upsert([], q, "Yes"), q), q).toBeNull();
    }
  });
  it("never keeps one asked for the country of employment or where you will work (#1590)", () => {
    for (const q of [
      "Are you legally authorized to work in the country of employment?",
      "Are you authorized to work in the country this role is in?",
      "Are you legally eligible to work in the country where you will be working?",
      "Are you authorized to work in the country where you'll work?",
      "Will you require visa sponsorship to work in the hiring country?",
    ]) {
      expect(isCommon(q, "Yes"), q).toBe(false);
      expect(match(upsert([], q, "Yes"), q), q).toBeNull();
    }
    expect(isCommon("Are you authorized to work in the United States?", "Yes")).toBe(true);
  });
  it("never keeps one asked for the country on the posting, the job location or this country (#1696)", () => {
    for (const q of [
      "Are you legally authorized to work in the country listed on this job posting?",
      "Are you authorized to work in the job location?",
      "Do you have the right to work in the country where you will be based?",
      "Are you authorized to work in the country where you would be employed?",
      "Are you eligible to work in the country where the job is?",
      "Will you now or in the future require sponsorship to work in this country?",
    ]) {
      expect(isCommon(q, "Yes"), q).toBe(false);
      expect(match(upsert([], q, "Yes"), q), q).toBeNull();
    }
    expect(isCommon("Are you legally authorized to work in the country where you live?", "Yes")).toBe(true);
    expect(isCommon("Are you authorized to work in the United Kingdom?", "Yes")).toBe(true);
  });
  it("never keeps one asked for the country you will be working in (#1748)", () => {
    for (const q of [
      "Are you legally authorized to work in the country you will be working in?",
      "Will you require visa sponsorship in the country you'll be working in?",
      "Are you authorized to work in the country you would work in?",
      "Do you need sponsorship to work in the country that you will work in?",
    ]) {
      expect(isCommon(q, "Yes"), q).toBe(false);
      expect(match(upsert([], q, "Yes"), q), q).toBeNull();
    }
    expect(isCommon("Are you authorized to work in the country you live in?", "Yes")).toBe(true);
    expect(isCommon("Are you authorized to work in the country where you live?", "Yes")).toBe(true);
  });
  it("never keeps one asked for the location(s) of this role, the posting country or the vacancy's country (#1818)", () => {
    for (const q of [
      "Will you now or in the future require sponsorship to work in the location(s) of this role?",
      "Are you legally authorized to work in the location(s) for this position?",
      "Are you authorized to work in the country(ies) of this job?",
      "Are you legally authorized to work in the posting country?",
      "Do you have the right to work in the country where the vacancy is based?",
      "Are you legally authorised to work in the country of the vacancy?",
    ]) {
      expect(isCommon(q, "No"), q).toBe(false);
      expect(match(upsert([], q, "No"), q), q).toBeNull();
    }
    expect(isCommon("Are you authorized to work in the United States for this position?", "Yes")).toBe(true);
    expect(isCommon("Will you require sponsorship to work in the United States?", "No")).toBe(true);
  });
  it("never reuses one saved before the fix", () => {
    const q = "Will you require sponsorship to work in the country where this role is based?";
    expect(match(upsert([], q, "No"), q)).toBeNull();
  });
  it("still keeps the same question about where the person lives", () => {
    expect(isCommon("Are you legally authorized to work in the country where you live?", "Yes")).toBe(true);
    expect(isCommon("Will you now or in the future require visa sponsorship for this role?", "No")).toBe(true);
  });
});

describe("the employer's city or office the person wants (#1706)", () => {
  it("is never kept or reused", () => {
    for (const q of [
      "Which city are you applying for?",
      "What is your preferred office location?",
      "Which city would you like to work in?",
      "Which office would you prefer to work from?",
      "Preferred work city",
      "Which city are you interested in?",
    ]) {
      expect(isCommon(q, "New York"), q).toBe(false);
      expect(match(upsert([], q, "New York"), q, ["New York", "London", "Austin"]), q).toBeNull();
    }
  });
  it("never reaches the drafting model when saved before the fix", () => {
    const old = [{ key: answerKey("Which city are you applying for?"), question: "Which city are you applying for?", answer: "New York", updatedAt: "2026-11-01T00:00:00.000Z" }];
    expect(savedBlock(old)).toBe("");
  });
  it("still keeps where the person lives or works now", () => {
    for (const q of ["What city do you live in?", "Current city", "City", "What city do you currently work in?", "City of residence"]) expect(isCommon(q, "New York"), q).toBe(true);
  });
});

describe("expected start and notice questions (#1595)", () => {
  it("keeps an expected start or notice period", () => {
    expect(isCommon("What is your expected start date?", "2 weeks after an offer")).toBe(true);
    expect(isCommon("Expected notice period?", "2 weeks")).toBe(true);
  });
  it("still keeps an expected start date that is a calendar date with one application", () => {
    expect(isCommon("What is your expected start date?", "12/1")).toBe(false);
  });
  it("still never keeps the expected pay", () => {
    expect(isCommon("Expected salary?", "$150k")).toBe(false);
    expect(isCommon("Expected start salary in your country?", "$150k")).toBe(false);
  });
});

describe("available to start (#1596)", () => {
  it("keeps a start span asked as availability", () => {
    expect(isCommon("When would you be available to start?", "2 weeks after an offer")).toBe(true);
    expect(isCommon("What is your availability to start?", "Immediately")).toBe(true);
  });
  it("keeps a calendar date with one application", () => {
    expect(onlyThisOne("When would you be available to start?", "12/1")).toBe(true);
    expect(isCommon("When are you available to start?", "January 2027")).toBe(false);
  });
});

describe("other ways to ask when you can start (#1874)", () => {
  const asks = [
    "When are you able to start?",
    "When could you start?",
    "How soon can you start?",
    "How soon could you start?",
    "When would you be able to start?",
    "What date can you start?",
    "When can you begin?",
    "Earliest date you could join?",
  ];
  it("keeps a start span", () => {
    for (const q of asks) expect(isCommon(q, "Two weeks after an offer"), q).toBe(true);
  });
  it("keeps a calendar date with one application", () => {
    for (const q of asks) expect(isCommon(q, "January 5, 2027"), q).toBe(false);
    expect(onlyThisOne("How soon can you start?", "Next Monday")).toBe(true);
  });
  it("leaves a call or interview alone", () => {
    expect(isCommon("When can you join a call with the team?", "Tomorrow at 2")).toBe(false);
    expect(isCommon("How soon could you start the interview process?", "Any time")).toBe(false);
  });
  it("matches a saved answer asked the same way", () => {
    const list = upsert([], "How soon can you start?", "Two weeks after an offer");
    expect(match(list, "How soon can you start?")).toBe("Two weeks after an offer");
  });
});

describe("other ways to ask work authorization (#1597)", () => {
  it("keeps legally able, eligible and right to work", () => {
    expect(isCommon("Are you legally able to work in the US?", "Yes")).toBe(true);
    expect(isCommon("Are you eligible to work in the US?", "Yes")).toBe(true);
    expect(isCommon("Do you have the right to work in the UK?", "Yes")).toBe(true);
    expect(isCommon("Are you eligible to work in the United States for this position?", "Yes")).toBe(true);
  });
  it("still never keeps one tied to where the job is", () => {
    expect(isCommon("Are you eligible to work in the country where this role is based?", "Yes")).toBe(false);
    expect(isCommon("Do you have the right to work in the country of employment?", "Yes")).toBe(false);
  });
});

describe("work permit questions are work authorization (#1619)", () => {
  it("keeps them", () => {
    expect(isCommon("Do you need a work permit?", "No")).toBe(true);
    expect(isCommon("Do you require a work permit to work in Germany?", "Yes")).toBe(true);
    expect(isCommon("Do you hold a valid work permit for the UK?", "Yes")).toBe(true);
    expect(isCommon("Do you need a work permit for this position?", "No")).toBe(true);
  });
  it("still never keeps one tied to where the job is", () => {
    expect(isCommon("Do you require a work permit for the country where this role is based?", "Yes")).toBe(false);
    expect(isCommon("Do you hold a work permit for the country of employment?", "Yes")).toBe(false);
  });
});

describe("moving to the employer's site or for this one job (#1814)", () => {
  it("is never kept or reused", () => {
    for (const q of [
      "Are you open to relocation to our headquarters?",
      "Are you willing to relocate to our New York office?",
      "Would you be willing to relocate to one of our offices?",
      "Are you able to relocate near our campus?",
      "Are you willing to relocate to Austin for this job?",
      "Would you relocate for the opportunity?",
      "Are you willing to relocate to the company's HQ?",
    ]) {
      expect(isCommon(q, "Yes"), q).toBe(false);
      expect(match(upsert([], q, "Yes"), q, ["Yes", "No"]), q).toBeNull();
    }
  });
  it("never reaches the drafting model when saved before the fix", () => {
    const q = "Are you open to relocation to our headquarters?";
    expect(savedBlock([{ key: answerKey(q), question: q, answer: "Yes", updatedAt: "2026-11-01T00:00:00.000Z" }])).toBe("");
  });
  it("still keeps whether the person will relocate at all", () => {
    for (const q of ["Are you willing to relocate?", "Open to relocation?", "Would you consider relocating to another state?"]) expect(isCommon(q, "Yes"), q).toBe(true);
  });
});
