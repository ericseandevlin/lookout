import { describe, expect, it } from "vitest";
import { checksBox, pickOne, pickOptions, planFill } from "./fillPlan";

const item = (o: Partial<Parameters<typeof planFill>[0][number]>) => ({ id: "i", kind: "answer" as const, prompt: "Q", required: true, fieldType: "text", options: null, approvedVersionId: null, ...o });

describe("planFill", () => {
  it("uploads resume and cover letter, picks choices, types the rest, skips unapproved and outreach", () => {
    const steps = planFill(
      [
        item({ id: "1", kind: "resume", prompt: "Resume/CV", approvedVersionId: "v1" }),
        item({ id: "2", kind: "cover_letter", prompt: "Cover Letter", required: false, approvedVersionId: null }),
        item({ id: "3", prompt: "Sponsorship?", options: ["Yes", "No"], approvedVersionId: "v3" }),
        item({ id: "4", kind: "field", prompt: "Email", approvedVersionId: "v4" }),
        item({ id: "5", kind: "outreach", prompt: "Maya Ortiz · Recruiter", required: false, approvedVersionId: "v5" }),
      ],
      [
        { id: "v1", content: "# Maya" },
        { id: "v3", content: "No" },
        { id: "v4", content: "maya@example.com" },
        { id: "v5", content: "Hi Maya, I'm applying…" },
      ],
    );
    expect(steps.map((s) => [s.prompt, s.kind, s.content])).toEqual([
      ["Resume/CV", "file", "# Maya"],
      ["Sponsorship?", "choice", "No"],
      ["Email", "text", "maya@example.com"],
    ]);
  });
});

describe("pickOptions (#165)", () => {
  const work = [
    "Yes, and I will not require employer support for employment visa status now or in the future for continued employment.",
    "Yes, but I will require employer support for employment visa status in the future for continued employment (if you are currently on H-1B, TN, E-3, or O-1 you will select this answer.)",
    "No, and I will require employer support for employment visa status in the future for continued employment.",
  ];
  it("matches the exact option text", () => {
    expect(pickOptions(work[0], work)).toEqual([work[0]]);
  });
  it("ticks several options, one per line, ignoring case and extra spaces", () => {
    expect(pickOptions(`${work[0].toUpperCase()}\n\n  ${work[2]}  `, work)).toEqual([work[0], work[2]]);
  });
  it("accepts an answer cut short, and drops lines that match nothing", () => {
    expect(pickOptions("Yes, but I will require employer support\nMaybe", work)).toEqual([work[1]]);
  });
  it("picks the closest option, not the first that shares a prefix (#632)", () => {
    expect(pickOptions("None", ["No", "None of the above"])).toEqual(["None of the above"]);
    expect(pickOptions("JavaScript (ES6)", ["Java", "JavaScript"])).toEqual(["JavaScript"]);
    expect(pickOptions("Yes, I am authorized", ["Yes", "No"])).toEqual(["Yes"]);
  });
  it("matches a prefix only at a word boundary (#632)", () => {
    expect(pickOptions("Nonprofit", ["No", "Yes"])).toEqual([]);
  });
  it("uses the answer as-is when the question listed no options", () => {
    expect(pickOptions("Remote", [])).toEqual(["Remote"]);
  });
});

describe("planFill options", () => {
  it("carries a choice item's options to the browser step", () => {
    const [s] = planFill([item({ id: "1", prompt: "Work authorization", options: ["Yes", "No"], approvedVersionId: "v1" })], [{ id: "v1", content: "Yes" }]);
    expect(s.options).toEqual(["Yes", "No"]);
  });
});

describe("checksBox (#669)", () => {
  it("ticks on yes, true and the consent verbs, alone or leading the answer", () => {
    for (const a of ["yes", "Yes", "TRUE", "agree", "I agree", "I acknowledge", "I confirm", "I consent", "I certify the above is true", "Accept", "Yes, I agree", "yes - happy to", "  yes  "]) expect(checksBox(a), a).toBe(true);
  });
  it("ticks on past tense and read-and-agree answers (#681)", () => {
    for (const a of ["Agreed", "Acknowledged.", "Confirmed", "Accepted", "Consented", "Certified", "I have read and agree", "I've read and acknowledge", "I’ve read and acknowledge", "I read and agree", "I understand and agree", "I understand", "I agreed to the terms"]) expect(checksBox(a), a).toBe(true);
  });
  it("leaves the box on no, empty or anything else", () => {
    for (const a of ["", "No", "false", "No, I do not agree", "I do not agree", "I don't consent", "Yesterday", "Agreement pending", "N/A", "Maybe", "I have read the terms", "I do not understand", "Disagreed", "Acceptance pending"]) expect(checksBox(a), a).toBe(false);
  });
});

describe("pickOne (#695)", () => {
  const long = "I acknowledge that I have read and understood the privacy notice for job applicants in the United States";
  it("takes exact text, then a word-boundary prefix either way, then a long label by its first 80 characters", () => {
    expect(pickOne("Yes", ["Select", "Yes", "No"])).toBe(1);
    expect(pickOne("yes ", ["Select", "Yes", "No"])).toBe(1);
    expect(pickOne("Yes, I am authorized to work in the US", ["Select", "Yes", "No"])).toBe(1);
    expect(pickOne("No", ["Select", "None of the above", "No, I do not have a disability"])).toBe(2);
    expect(pickOne("None", ["No", "None of the above"])).toBe(1);
    expect(pickOne(`${long}.`, ["Select", `${long} (2026 edition)`])).toBe(1);
  });
  it("is -1 when no option fits", () => {
    expect(pickOne("They/them", ["She/her", "He/him"])).toBe(-1);
    expect(pickOne("Maybe", ["Yes", "No"])).toBe(-1);
    expect(pickOne("Yes", [])).toBe(-1);
  });
});
