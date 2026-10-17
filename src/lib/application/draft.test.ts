import { describe, expect, it } from "vitest";
import { linkedinUrl, checkAnswer, fillField, hasKeyword, keywordReport, newNumbers, resumeNote, type DraftInputs } from "./draft";

const inp: DraftInputs = {
  name: "Maya Ortiz Reyes",
  email: "maya@example.com",
  linkedinUrl: "https://www.linkedin.com/in/maya",
  links: [],
  brief: "",
  resume: "",
  posting: { company: "Acme", title: "Director", text: "" },
};

describe("fillField", () => {
  it("fills name, email and LinkedIn from the account", () => {
    expect(fillField("First Name", inp)?.content).toBe("Maya");
    expect(fillField("Last Name", inp)?.content).toBe("Ortiz Reyes");
    expect(fillField("Preferred First Name", inp)?.content).toBe("Maya");
    expect(fillField("Name", inp)?.content).toBe("Maya Ortiz Reyes");
    expect(fillField("Email", inp)?.content).toBe("maya@example.com");
    expect(fillField("LinkedIn Profile", inp)?.content).toBe("https://www.linkedin.com/in/maya");
  });

  it("turns a LinkedIn handle into a URL", () => {
    expect(linkedinUrl("ericseandevlin")).toBe("https://www.linkedin.com/in/ericseandevlin");
    expect(linkedinUrl("linkedin.com/in/maya/")).toBe("https://linkedin.com/in/maya");
    expect(linkedinUrl("https://www.linkedin.com/in/maya")).toBe("https://www.linkedin.com/in/maya");
    expect(fillField("LinkedIn Profile", { ...inp, linkedinUrl: "maya" })?.content).toBe("https://www.linkedin.com/in/maya");
  });

  it("leaves everything else to the model", () => {
    expect(fillField("Phone", inp)).toBeNull();
    expect(fillField("LinkedIn Profile", { ...inp, linkedinUrl: null })).toBeNull();
  });
});

describe("keywords", () => {
  it("matches whole words, ignoring case and punctuation", () => {
    expect(hasKeyword("Led design systems at scale.", "Design Systems")).toBe(true);
    expect(hasKeyword("Built in React/TypeScript", "TypeScript")).toBe(true);
    expect(hasKeyword("Reactive programming", "React")).toBe(false);
    expect(hasKeyword("C# and .NET", "C#")).toBe(true);
  });

  it("reports coverage before and after, with where each was added", () => {
    const r = keywordReport("Led design systems.", "Led design systems and accessibility work.", {
      keywords: ["design systems", "accessibility", "GraphQL", "Accessibility"],
      resume: "",
      changes: [{ keyword: "Accessibility", where: "Experience: Citi" }],
      note: "Moved a11y work up.",
    });
    expect(r).toEqual([
      { term: "design systems", before: true, after: true },
      { term: "accessibility", before: false, after: true, where: "Experience: Citi" },
      { term: "GraphQL", before: false, after: false },
    ]);
    expect(resumeNote(r, { keywords: [], resume: "", changes: [], note: "Moved a11y work up." }, [])).toBe(
      "Keyword match 1/3 → 2/3. Added: accessibility (Experience: Citi). Moved a11y work up.",
    );
  });
});

describe("keywordReport with the person's picks", () => {
  it("shows picks even when the model skipped them, and marks them", () => {
    const r = keywordReport("Led design systems.", "Led design systems with AI fluency.", { keywords: ["design systems", "SQL"], resume: "", changes: [], note: "" }, "design systems, SQL, AI fluency", { include: ["AI fluency"], exclude: ["SQL"] });
    expect(r).toEqual([
      { term: "design systems", before: true, after: true },
      { term: "SQL", before: false, after: false, choice: "exclude" },
      { term: "AI fluency", before: false, after: true, choice: "include" },
    ]);
  });
});

describe("keywordReport with the posting", () => {
  it("drops keywords that aren't in the posting (invented or planted)", () => {
    const r = keywordReport("Led design systems.", "Led design systems and pomegranate work.", { keywords: ["design systems", "pomegranate"], resume: "", changes: [], note: "" }, "We need design systems leadership.");
    expect(r.map((x) => x.term)).toEqual(["design systems"]);
  });
});

describe("newNumbers", () => {
  it("flags numbers the master resume never had, not years", () => {
    const master = "Grew revenue 40% to $2.5M across 12 teams, 2019 to 2024.";
    expect(newNumbers(master, "Grew revenue 40% to $2.5M across 12 teams.")).toEqual([]);
    expect(newNumbers(master, "Grew revenue 45% across 30 teams in 2021.")).toEqual(["45%", "30"]);
  });
});

describe("checkAnswer", () => {
  const sel = { index: 3, kind: "answer" as const, prompt: "Will you require sponsorship?", required: true, options: ["Yes", "No"] };

  it("keeps a real option, matching its exact spelling", () => {
    expect(checkAnswer(sel, { index: 3, content: "no", sources: ["profile: work authorization"], question: "", note: "" })).toMatchObject({ content: "No", question: null });
  });

  it("turns a made-up option into a question", () => {
    const d = checkAnswer(sel, { index: 3, content: "Not at this time", sources: [], question: "", note: "" });
    expect(d.content).toBe("");
    expect(d.question).toMatch(/Yes, No/);
  });

  it("asks when the model left it blank or skipped it", () => {
    expect(checkAnswer(sel, undefined).question).toMatch(/sponsorship/);
    expect(checkAnswer({ ...sel, options: null }, { index: 3, content: "", sources: [], question: "", note: "" }).question).toMatch(/sponsorship/);
  });
});

