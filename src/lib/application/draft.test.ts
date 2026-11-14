import { describe, expect, it } from "vitest";
import { answersPrompt, linkedinUrl, withLinkedin, checkAnswer, fillField, hasKeyword, keywordReport, newNumbers, resumeNote, type DraftInputs } from "./draft";

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

  it("fills a full-name label that carries a required marker (#817)", () => {
    for (const label of ["Name *", "Full Name *", "Full name (required)", "Name:", "Full Name*"]) expect(fillField(label, inp)?.content).toBe("Maya Ortiz Reyes");
    expect(fillField("Name pronunciation", inp)).toBeNull();
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

describe("withLinkedin (#736)", () => {
  const md = "# Maya Lin\nNew York • maya@example.com • maya.co • linkedin.com/in/mayal\n\n## Experience\n- Wrote about linkedin.com/in/someone-else";
  it("puts the profile's link in the contact block and leaves the rest alone", () => {
    const out = withLinkedin(md, "https://www.linkedin.com/in/mayalin/");
    expect(out).toContain("maya.co • linkedin.com/in/mayalin\n");
    expect(out).toContain("linkedin.com/in/someone-else");
  });
  it("replaces a full URL too, and does not double a correct one", () => {
    expect(withLinkedin("# M\nhttps://www.linkedin.com/in/mayal/ • x\n\n## E", "linkedin.com/in/mayalin")).toBe("# M\nlinkedin.com/in/mayalin • x\n\n## E");
    expect(withLinkedin("# M\nlinkedin.com/in/mayalin\n\n## E", "https://www.linkedin.com/in/mayalin")).toBe("# M\nlinkedin.com/in/mayalin\n\n## E");
  });
  it("changes nothing without a profile link", () => {
    expect(withLinkedin(md, null)).toBe(md);
  });
});

describe("keywords", () => {
  it("matches whole words, ignoring case and punctuation", () => {
    expect(hasKeyword("Led design systems at scale.", "Design Systems")).toBe(true);
    expect(hasKeyword("Built in React/TypeScript", "TypeScript")).toBe(true);
    expect(hasKeyword("Reactive programming", "React")).toBe(false);
    expect(hasKeyword("C# and .NET", "C#")).toBe(true);
    // A short skill is its own word, not a piece of R&D, go-to-market or C-suite (#1087).
    expect(hasKeyword("Ran the R&D design team of 12", "R")).toBe(false);
    expect(hasKeyword("Led go-to-market launches", "Go")).toBe(false);
    expect(hasKeyword("Presented to the C-suite", "C")).toBe(false);
    expect(hasKeyword("Owned the P&L", "P")).toBe(false);
    expect(hasKeyword("Built models in Python or R.", "R")).toBe(true);
    expect(hasKeyword("R/Python, R&D lead", "R")).toBe(true);
    expect(hasKeyword("Services in Go, C++ and C#", "Go")).toBe(true);
    expect(hasKeyword("Shipped AI-driven search", "AI")).toBe(true);
    expect(hasKeyword("Wrote C and C++", "C")).toBe(true);
  });

  it("reports coverage before and after, with where each was added", () => {
    const r = keywordReport("Led design systems.", "Led design systems and accessibility work.", {
      keywords: ["design systems", "accessibility", "GraphQL", "Accessibility"],
      resume: "",
      changes: [{ keyword: "Accessibility", where: "Experience: Citi" }],
      notes: ["Moved a11y work up."],
    });
    expect(r).toEqual([
      { term: "design systems", before: true, after: true },
      { term: "accessibility", before: false, after: true, where: "Experience: Citi" },
      { term: "GraphQL", before: false, after: false },
    ]);
    expect(resumeNote(r, { keywords: [], resume: "", changes: [], notes: ["Moved a11y work up."] }, ["17+"])).toBe(
      "- Keyword match 1/3 → 2/3\n- Added:\n  - accessibility (Experience: Citi)\n- Moved a11y work up.\n- Check these numbers, they aren't in your master resume: 17+",
    );
  });
});

describe("keywordReport with the person's picks", () => {
  it("shows picks even when the model skipped them, and marks them", () => {
    const r = keywordReport("Led design systems.", "Led design systems with AI fluency.", { keywords: ["design systems", "SQL"], resume: "", changes: [], notes: [] }, "design systems, SQL, AI fluency", { include: ["AI fluency"], exclude: ["SQL"] });
    expect(r).toEqual([
      { term: "design systems", before: true, after: true },
      { term: "SQL", before: false, after: false, choice: "exclude" },
      { term: "AI fluency", before: false, after: true, choice: "include" },
    ]);
  });
});

describe("keywordReport with the posting", () => {
  it("drops keywords that aren't in the posting (invented or planted)", () => {
    const r = keywordReport("Led design systems.", "Led design systems and pomegranate work.", { keywords: ["design systems", "pomegranate"], resume: "", changes: [], notes: [] }, "We need design systems leadership.");
    expect(r.map((x) => x.term)).toEqual(["design systems"]);
  });
});

describe("newNumbers", () => {
  it("flags numbers the master resume never had, not years", () => {
    const master = "Grew revenue 40% to $2.5M across 12 teams, 2019 to 2024.";
    expect(newNumbers(master, "Grew revenue 40% to $2.5M across 12 teams.")).toEqual([]);
    expect(newNumbers(master, "Grew revenue 45% across 30 teams in 2021.")).toEqual(["45%", "30"]);
  });

  it("doesn't take the next word's first letter as a unit (#891)", () => {
    expect(newNumbers("Mentored 6 designers across 3 teams.", "Mentored 6 mid-level designers across 3 business teams.")).toEqual([]);
    expect(newNumbers("Cut load time to 100ms for 5 brands.", "Cut load time to 100ms for 5 key brands.")).toEqual([]);
    expect(newNumbers("Raised $2M with 10x growth.", "Raised $3M with 10x growth and 10+ hires.")).toEqual(["$3m", "10+"]);
    expect(newNumbers("Led 4 teams.", "Led 4 teams and $5 million in spend.")).toEqual(["$5m"]);
  });

  it("reads one fact in two spellings as the same number (#901)", () => {
    expect(newNumbers("Grew revenue to $1.2 million in 2021.", "Grew revenue to $1.2M in 2021.")).toEqual([]);
    expect(newNumbers("Managed a $300 thousand budget, up 20 percent.", "Managed a $300K budget, up 20%.")).toEqual([]);
    expect(newNumbers("Over 15 years leading teams.", "15+ years leading teams.")).toEqual([]);
    expect(newNumbers("More than 40 engineers.", "40+ engineers.")).toEqual([]);
    expect(newNumbers("Staff Engineer, Jan 2020 to 03/2023.", "Staff Engineer, 01/2020 to 03/2023.")).toEqual([]);
  });

  it("still flags a number the master never had, in any spelling (#901)", () => {
    expect(newNumbers("Grew revenue to $1.2 million.", "Grew revenue to $1.5M.")).toEqual(["$1.5m"]);
    expect(newNumbers("15 years leading teams.", "15+ years leading teams.")).toEqual(["15+"]);
    expect(newNumbers("Over 15 years.", "20+ years.")).toEqual(["20+"]);
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

  describe("select-any questions (#624)", () => {
    const multi = { index: 4, kind: "answer" as const, prompt: "Which areas have you worked in?", required: false, options: ["Design systems", "Research", "Front-end"], multi: true };
    const raw = (content: string) => ({ index: 4, content, sources: [], question: "", note: "" });

    it("keeps every real option, one per line, in the form's spelling", () => {
      expect(checkAnswer(multi, raw("design systems\n- Front-end\n\nDesign systems"))).toMatchObject({ content: "Design systems\nFront-end", question: null });
    });

    it("asks when any line isn't an option", () => {
      const d = checkAnswer(multi, raw("Design systems\nMarketing"));
      expect(d.content).toBe("");
      expect(d.question).toMatch(/Design systems, Research, Front-end/);
    });

    it("still wants a single option when the question isn't select-any", () => {
      expect(checkAnswer({ ...multi, multi: false }, raw("Design systems\nResearch")).content).toBe("");
    });
  });

  it("marks select-any questions in the prompt (#624)", () => {
    const p = answersPrompt(inp, [{ index: 0, kind: "answer", prompt: "Areas?", required: false, options: ["A", "B"], multi: true }, { index: 1, kind: "answer", prompt: "Sponsorship?", required: true, options: ["Yes", "No"] }]);
    expect(p).toContain("0. [answer, select any] Areas?");
    expect(p).toContain("1. [answer, required] Sponsorship?");
  });
});


describe("newNumbers: the same number spelled another way (#1148)", () => {
  it("a plain number the master states with \"over\" is not new", () => {
    expect(newNumbers("Managed over 20 engineers.", "Managed 20 engineers.")).toEqual([]);
  });
  it("round numbers compare across spellings", () => {
    expect(newNumbers("Grew to 1,000,000 users.", "Grew to 1M users.")).toEqual([]);
    expect(newNumbers("Saved $250K a year.", "Saved $250,000 a year.")).toEqual([]);
    expect(newNumbers("Raised $1,200,000.", "Raised $1.2 million.")).toEqual([]);
  });
  it("\"MM\" is millions (#1170)", () => {
    expect(newNumbers("Managed a $5M budget", "Managed a $5MM budget")).toEqual([]);
    expect(newNumbers("Managed a $5,000,000 budget", "Managed a $5 MM budget")).toEqual([]);
    expect(newNumbers("Managed a $5MM budget", "Managed a $5M budget")).toEqual([]);
    expect(newNumbers("Managed a $5MM budget", "Managed a $6MM budget")).toEqual(["$6m"]);
  });
  it("a bigger claim is still new", () => {
    expect(newNumbers("Managed 20 engineers.", "Managed over 20 engineers.")).toEqual(["20+"]);
    expect(newNumbers("Grew to 1,000,000 users.", "Grew to 2M users.")).toEqual(["2m"]);
  });
});
