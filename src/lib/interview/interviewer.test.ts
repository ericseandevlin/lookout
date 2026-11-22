import { describe, expect, it } from "vitest";
import { closedTopics, INTERVIEW_SYSTEM, interviewPrompt, plainQuestion, shortWhy } from "./interviewer";
import { isQuestionBack } from "./rules";

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

describe("the question only (#1449)", () => {
  it.each([
    ["4 of your top 5 finds are B2B SaaS companies, and your resume shows fashion, media and agency work. Have you worked on B2B or enterprise SaaS products?", "Have you worked on B2B or enterprise SaaS products?"],
    ["Your top find at Harbor Hall has a team of 12, larger than your current 9. How many people have you hired and managed at once, and did you lead that team yourself?", "How many people have you hired and managed at once, and did you lead that team yourself?"],
    ["Have you run F&B for events? If so, how big?", "Have you run F&B for events? If so, how big?"],
    ["Have you worked on B2B SaaS products?", "Have you worked on B2B SaaS products?"],
    ["Tell me about your biggest event.", "Tell me about your biggest event."],
    ["Your top finds all want someone who prototypes with AI and ships real product. Walk me through a time you used AI to take an idea to something shipped.", "Walk me through a time you used AI to take an idea to something shipped."],
    ["Think of your biggest event. Walk me through it.", "Think of your biggest event. Walk me through it."],
  ])("cuts the evidence in front: %s", (input, want) => {
    expect(plainQuestion(input)).toBe(want);
  });

  it("the prompt asks for a plain question with a bad and a good example, and answers a question back", () => {
    expect(INTERVIEW_SYSTEM).toContain('Good: "Have you worked on B2B or enterprise SaaS products?"');
    expect(INTERVIEW_SYSTEM).toMatch(/Bad: "4 of your top 5 finds are B2B SaaS companies/);
    expect(INTERVIEW_SYSTEM).toContain("why do you ask?");
  });

  it("knows a question back from an answer", () => {
    for (const a of ["Why do you ask?", "what do you mean?", "How is that relevant?", "Sorry, which part?"]) expect(isQuestionBack(a)).toBe(true);
    for (const a of ["Yes, I ran F&B for 3 venues.", "I led it. Why? Because nobody else would.", "", "No"]) expect(isQuestionBack(a)).toBe(false);
  });
});
