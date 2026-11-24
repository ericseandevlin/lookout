import { describe, expect, it } from "vitest";
import { closedTopics, INTERVIEW_SYSTEM, interviewPrompt, noDashes, plainQuestion, shortWhy, STORY_RULES } from "./interviewer";
import { asksToStop, isBareNo, isBareYes, isQuestionBack } from "./rules";

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

  it("cuts prompt text a model ran on into", () => {
    const leaked = 'Head of Private Events at The Linden Museum asks for galas and member events at a cultural venue. Bad: "4 of your top 5 finds ask for B2B SaaS or enterprise product experience. " Good: "4 of your top 5 finds ask for B2B SaaS. " - topic: two to five plain words naming';
    expect(shortWhy(leaked)).toBe("Head of Private Events at The Linden Museum asks for galas and member events at a cultural venue.");
    expect(shortWhy("2 of your top 5 finds ask for it - topic: event sales")).toBe("2 of your top 5 finds ask for it");
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
    expect(INTERVIEW_SYSTEM).toContain('Good: "Tell me about B2B or enterprise software you\'ve worked on');
    expect(INTERVIEW_SYSTEM).toContain('Bad: "Have you managed managers?"');
    expect(INTERVIEW_SYSTEM).toMatch(/Bad: "4 of your top 5 finds are B2B SaaS companies/);
    expect(INTERVIEW_SYSTEM).toContain("why do you ask?");
  });

  it("knows a question back from an answer", () => {
    for (const a of ["Why do you ask?", "what do you mean?", "How is that relevant?", "Sorry, which part?"]) expect(isQuestionBack(a)).toBe(true);
    // A lead-in before the question (#1662).
    for (const a of ["Quick question first: does CFS say if the role is hybrid?", "Hang on. Is this for the CFS role?"]) expect(isQuestionBack(a), a).toBe(true);
    expect(isQuestionBack("ok I think that is enough for today, can we stop here?")).toBe(false);
    for (const a of ["Yes, I ran F&B for 3 venues.", "I led it. Why? Because nobody else would.", "", "No"]) expect(isQuestionBack(a)).toBe(false);
  });
});

describe("a question is never cut in the middle (#1662)", () => {
  it("keeps a decimal number whole", () => {
    const q = "How did you get central line infections down from 1.9 to 0.6?";
    expect(plainQuestion(q)).toBe(q);
    expect(plainQuestion(`Your top finds ask for quality monitoring. ${q}`)).toBe(q);
    expect(shortWhy("Asked by 3 finds with a 2.5 year minimum.")).toBe("Asked by 3 finds with a 2.5 year minimum.");
  });

  it("keeps the statement a question leans on, and still cuts the evidence", () => {
    const q = "You said you are working toward a certification. Which one, and how far along are you?";
    expect(plainQuestion(q)).toBe(q);
    expect(plainQuestion(`3 of your top finds ask for it. ${q}`)).toBe(q);
  });
});

describe("no dashes in what Lookout writes (#1531)", () => {
  it("turns em and en dashes into commas in reasons and questions", () => {
    expect(noDashes("3 of your top 5 finds ask for it — twice")).toBe("3 of your top 5 finds ask for it, twice");
    expect(shortWhy("Asked by 3 finds – all senior.")).toBe("Asked by 3 finds, all senior.");
    expect(plainQuestion("Quick one—have you led a team?")).toBe("Quick one, have you led a team?");
  });
});

describe("a bare yes or no (#1485)", () => {
  it("knows a yes with no story", () => {
    for (const a of ["yes", "Yes.", "yeah", "Yep!", "I have", "Yes, I have.", "definitely"]) expect(isBareYes(a)).toBe(true);
    for (const a of ["Yes, at Acme I led 3 managers.", "yes but only once in 2019", "no"]) expect(isBareYes(a)).toBe(false);
  });
  it("knows a no", () => {
    for (const a of ["no", "No.", "nope", "Not really", "I haven't", "never"]) expect(isBareNo(a)).toBe(true);
    for (const a of ["No, but I did something close at Acme.", "yes", "not as the lead, I was on the team"]) expect(isBareNo(a)).toBe(false);
  });
  it("asks for stories, in both interviews", () => {
    expect(STORY_RULES).toContain("Ask for a story, not a yes or no");
    expect(INTERVIEW_SYSTEM).toContain(STORY_RULES);
  });
});

describe("the recruiter's stance (#1485)", () => {
  it("coaches from the resume, one open question at a time, never a bare yes or no", async () => {
    const { INTERVIEW_SYSTEM, isYesNoQuestion } = await import("./interviewer");
    expect(INTERVIEW_SYSTEM).toContain("seasoned executive recruiter");
    // A result with numbers and no names is shareable: too careful a lock keeps it out of drafts (#1531).
    expect(INTERVIEW_SYSTEM).toContain("A result with numbers and no names is not confidential");
    expect(INTERVIEW_SYSTEM).toContain('Never make the whole question "Have you done X?"');
    expect(isYesNoQuestion("Have you led production for large events?")).toBe(true);
    expect(isYesNoQuestion("Did you manage the budget?")).toBe(true);
    expect(isYesNoQuestion("Have you led production for large events? Tell me where, and your part.")).toBe(false);
    expect(isYesNoQuestion("Tell me about a time you led other managers.")).toBe(false);
  });
});


describe("asksToStop (#1662)", () => {
  it("reads a request to end the interview", () => {
    for (const a of ["ok I think that is enough for today, can we stop here?", "Can we stop?", "let's pause", "That's it for now", "I need to wrap up", "Let's call it a day", "pick this up later"]) expect(asksToStop(a), a).toBe(true);
  });
  it("leaves answers about work alone", () => {
    for (const a of ["I stopped the bleeding on a $2M project.", "We had to end the contract early.", "Done for the quarter: closed the books in 5 days.", "", "x ".repeat(100) + "can we stop?"]) expect(asksToStop(a), a).toBe(false);
  });
});
