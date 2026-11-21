import { describe, expect, it } from "vitest";
import { closedTopics, INTERVIEW_SYSTEM, interviewPrompt, shortWhy } from "./interviewer";

describe("shortWhy (#1449)", () => {
  it.each([
    ["4 of your top 5 finds ask for B2B SaaS or enterprise product experience, and nothing in your resume clearly shows it.", "4 of your top 5 finds ask for B2B SaaS or enterprise product experience."],
    ["4 of your top 5 finds ask for B2B SaaS, and nothing in your resume shows it.", "4 of your top 5 finds ask for B2B SaaS."],
    ["3 of your top 5 finds ask for F&B experience, but your resume doesn't show it.", "3 of your top 5 finds ask for F&B experience."],
    ["3 of your top 5 finds ask for F&B experience and your resume doesn't mention it", "3 of your top 5 finds ask for F&B experience."],
    ["2 of your top 5 finds ask for event sales leadership; your resume is silent on it.", "2 of your top 5 finds ask for event sales leadership."],
    ["It's asked by 3 of your top 5 finds. Nothing in your resume backs it.", "It's asked by 3 of your top 5 finds."],
    ["The Director of Events role leads a team of 12, and your resume only shows a team of 9 with no detail on your hiring.", "The Director of Events role leads a team of 12."],
  ])("cuts the resume tail: %s", (input, want) => {
    expect(shortWhy(input)).toBe(want);
  });

  it.each([
    "2 of your top 5 finds ask for event sales leadership.",
    "One of the five setup questions. Every search starts from your answer.",
    "Your resume shows hotel events, and 3 of your top 5 finds ask for weddings.",
    "3 of your top 5 finds ask for budgets, scheduling, and vendor contracts.",
  ])("keeps a reason with no resume tail: %s", (input) => {
    expect(shortWhy(input)).toBe(input);
  });

  it("never returns an empty reason", () => {
    expect(shortWhy("Nothing in your resume shows it.")).toBe("Nothing in your resume shows it.");
    expect(shortWhy("")).toBe("");
  });

  it("the prompt asks for the evidence only, with a bad and a good example", () => {
    expect(INTERVIEW_SYSTEM).toContain("Never say what the resume or profile lacks");
    expect(INTERVIEW_SYSTEM).toMatch(/Bad: ".*nothing in your resume clearly shows it\."/);
    expect(INTERVIEW_SYSTEM).toContain('Good: "4 of your top 5 finds ask for B2B SaaS or enterprise product experience."');
  });
});

describe("old Doesn't apply rows (#1449)", () => {
  it("still close a topic after Skip and Doesn't apply were merged", () => {
    const past = [
      { topic: "Event CRM", outcome: "not_applicable" },
      { topic: "budgets", outcome: "skipped" },
      { topic: "catering", outcome: "answered" },
    ];
    expect([...closedTopics(past)].sort()).toEqual(["budgets", "event crm"]);
    const p = interviewPrompt({ profile: "", resume: "", finds: [], facts: [], past, followUpsLeft: 0 });
    expect(p).toContain("Never ask again: budgets; Event CRM");
  });
});
