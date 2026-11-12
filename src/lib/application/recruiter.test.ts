import { describe, expect, it } from "vitest";
import { finishAnalysis, honestyFindings, recruiterChecks } from "./recruiter";

const resume = `# Maya Ortiz
New York, NY • maya@example.com

## Summary
Design systems lead with ten years of experience building component libraries, documentation sites and the teams that run them across large banks, media companies and startups in New York and London, now hoping to move into product management.

## Experience
### UX Engineering Lead, Acme | New York, NY | 07/2021 – Present
- Built the design system site used across the firm.
- Grew the team from 3 to 12 engineers.
- Ran design reviews for the platform group.
### Front-End Developer, Studio | 2016 – 2021
- Shipped sites.

## Skills
- React, TypeScript, Accessibility Concepts`;

describe("recruiterChecks: resume", () => {
  const f = recruiterChecks("resume", resume);

  it("flags a missing headline", () => {
    expect(f.some((x) => x.dim === "scan" && /headline/.test(x.what))).toBe(true);
    expect(recruiterChecks("resume", resume.replace("New York, NY •", "Design Systems Lead\nNew York, NY •")).some((x) => /headline/.test(x.what))).toBe(false);
  });

  it("flags a long summary and 'moving into' framing, quoting the line", () => {
    const long = f.find((x) => /summary runs/.test(x.what))!;
    expect(long.line).toMatch(/^Design systems lead/);
    expect(f.some((x) => x.dim === "relevance" && x.line === long.line)).toBe(true);
  });

  it("checks a summary under an \"Executive Summary\" heading too (#767)", () => {
    const g = recruiterChecks("resume", resume.replace(/^## Summary$/m, "## Executive Summary"));
    expect(g.some((x) => /summary runs/.test(x.what))).toBe(true);
  });

  it("names latest-role bullets with no number, and only those", () => {
    const bare = f.filter((x) => x.dim === "impact" && x.line).map((x) => x.line);
    expect(bare).toEqual(["Built the design system site used across the firm.", "Ran design reviews for the platform group."]);
    expect(f.find((x) => x.line === bare[0])!.fix).toMatch(/ask me/);
  });

  it("counts only work bullets for numbers, not Skills or Education (#704)", () => {
    const one = `# Maya Ortiz
Design Systems Lead

## Experience
### UX Engineering Lead, Acme | 2016 – Present
- Grew the team from 3 to 12 engineers.
- Cut build time by 40%.
- Ran design reviews for the platform group.
- Wrote the contribution guide.
- Shipped 30 components in the first year.
- Led the accessibility audit.

## Skills
- React, TypeScript, Storybook
- Figma, design tokens

## Education
### BFA, Rhode Island School of Design
- Graphic design`;
    const g = recruiterChecks("resume", one);
    expect(g.filter((x) => x.dim === "impact" && x.line).map((x) => x.line)).toEqual(["Ran design reviews for the platform group.", "Wrote the contribution guide.", "Led the accessibility audit."]);
    expect(recruiterChecks("resume", one.replace(/ from 3 to 12 engineers| by 40%|30 /g, " ")).some((x) => /bullets carry a number/.test(x.what))).toBe(true);
    const numbered = one.replace("Wrote the contribution guide.", "Wrote the guide 200 people use.").replace("Led the accessibility audit.", "Led the audit of 40 apps.");
    expect(recruiterChecks("resume", numbered).filter((x) => x.dim === "impact" && x.line).map((x) => x.line)).toEqual(["Ran design reviews for the platform group."]);
    const skillsHeavy = one.replace("- Figma, design tokens", "- Figma, design tokens\n- Sketch\n- Accessibility\n- Prototyping\n- Research");
    expect(skillsHeavy.match(/^- /gm)!.length).toBe(13);
    expect(recruiterChecks("resume", skillsHeavy).some((x) => /bullets carry a number/.test(x.what))).toBe(false);
  });

  it("flags vague skill phrases in the skills section", () => {
    expect(f.some((x) => x.what.includes('"Accessibility Concepts"'))).toBe(true);
  });

  it("every finding says what, why and how", () => {
    for (const x of f) expect(x.what && x.why && x.fix).toBeTruthy();
  });

  it("is quiet on an empty draft", () => {
    expect(recruiterChecks("resume", "")).toEqual([]);
  });
});

describe("recruiterChecks: cover letter", () => {
  it("flags the stock opening, framing and length", () => {
    const letter = `Dear Hiring Manager,\n\nI am writing to apply for the Product Designer role. I have led design work for years.\n\nI am hoping to move into product design full time. ${"More detail here. ".repeat(110)}\n\nSincerely,\nMaya`;
    const f = recruiterChecks("cover_letter", letter);
    expect(f.find((x) => x.dim === "scan")!.line).toBe("I am writing to apply for the Product Designer role.");
    expect(f.some((x) => x.dim === "relevance")).toBe(true);
    expect(f.some((x) => x.dim === "length")).toBe(true);
  });

  it("checks a letter written with single line breaks, without its greeting and sign-off (#706)", () => {
    const letter = `Dear Hiring Manager,\nI am writing to apply for the Product Designer role. ${"More detail here. ".repeat(110)}\nThanks,\nMaya Ortiz\nmaya@example.com`;
    const f = recruiterChecks("cover_letter", letter);
    expect(f.find((x) => x.dim === "scan")!.line).toBe("I am writing to apply for the Product Designer role.");
    expect(f.find((x) => x.dim === "length")!.what).toBe("About 340 words.");
    const sameLine = recruiterChecks("cover_letter", "Dear Team, I am excited to apply for this role.\nI grew Acme's design system to 40 teams.");
    expect(sameLine.find((x) => x.dim === "scan")!.line).toBe("I am excited to apply for this role.");
    expect(recruiterChecks("cover_letter", "Hi Sam,\nI grew Acme's design system to 40 teams in two years.\nThank you for your time.\nBest regards,\nMaya")).toEqual([]);
  });

  it("flags the person moving into a field, not a team or product changing (#768)", () => {
    const framed = (s: string) => recruiterChecks("cover_letter", `Dear Team,\n\n${s}\n\nBest,\nMaya`).some((x) => x.dim === "relevance");
    for (const s of [
      "I am looking to transition into product management.",
      "I’m transitioning to product design after ten years in engineering.",
      "My career pivot to research started last year.",
      "I am eager to break into fintech.",
      "As a career changer, I bring a fresh view.",
    ])
      expect(framed(s)).toBe(true);
    for (const s of [
      "At Acme I led the pivot to subscriptions, which grew revenue 20%.",
      "I ran the company's transition into cloud billing for 40 teams.",
      "I helped the brand break into three new markets.",
      "I am moving to Boston in June and grew Acme's design system to 40 teams.",
    ])
      expect(framed(s)).toBe(false);
    expect(recruiterChecks("resume", resume.replace(/now hoping to move into product management/, "led the transition into cloud billing")).some((x) => x.dim === "relevance")).toBe(false);
  });

  it("passes a strong short letter", () => {
    expect(recruiterChecks("cover_letter", "Dear Team,\n\nI grew Acme's design system to 40 teams in two years.\n\nBest,\nMaya")).toEqual([]);
  });
});

describe("honestyFindings", () => {
  it("turns invented numbers and role swaps into findings", () => {
    const f = honestyFindings(["40%"], ['"Built X" is under B here, but under A in your master resume. Check it.']);
    expect(f.map((x) => x.dim)).toEqual(["honesty", "honesty"]);
    expect(f[1].fix).toContain("40%");
  });
});

describe("finishAnalysis", () => {
  const doc = "### Lead, Acme | 2021 – Present\n- Built the design system site used across the firm.\n- Grew the team from 3 to 12 engineers.";
  const code = recruiterChecks("resume", doc);

  it("clamps scores, averages to 0-100, keeps real quotes and drops made-up ones", () => {
    const a = finishAnalysis(
      "v1",
      doc,
      {
        scores: { scan: 12, impact: 6, relevance: 7.4, honesty: -1, length: 8 },
        verdict: " Solid. ",
        findings: [
          { dim: "relevance", line: "Grew the team from 3 to 12 engineers.", what: "No tie to the posting.", why: "x", fix: "Tie it." },
          { dim: "scan", line: "A line that isn't in the document at all", what: "Made up.", why: "x", fix: "Fix it." },
        ],
      },
      code,
      new Date("2026-11-03T00:00:00Z"),
    );
    expect(a.scores).toEqual({ scan: 10, impact: 6, relevance: 7, honesty: 0, length: 8 });
    expect(a.overall).toBe(62);
    expect(a.verdict).toBe("Solid.");
    expect(a.findings.find((f) => f.what === "No tie to the posting.")!.line).toBe("Grew the team from 3 to 12 engineers.");
    expect(a.findings.find((f) => f.what === "Made up.")!.line).toBeUndefined();
  });

  it("drops a model finding about a line code already flagged", () => {
    const flagged = code.find((f) => f.line)!;
    const a = finishAnalysis("v1", doc, { scores: { scan: 5, impact: 5, relevance: 5, honesty: 5, length: 5 }, verdict: "", findings: [{ dim: "impact", line: flagged.line!, what: "Same thing.", why: "x", fix: "y" }] }, code);
    expect(a.findings.filter((f) => f.from === "model")).toEqual([]);
  });
});

describe("fix now or needs a fact (#738)", () => {
  it("marks the number checks as needing a fact from the person", () => {
    const md = "# Ana Ruiz\n## Experience\n### Lead Designer, Acme\n- Ran the design system\n- Shipped the new checkout";
    const f = recruiterChecks("resume", md);
    expect(f.filter((x) => x.dim === "impact").every((x) => x.needsFact)).toBe(true);
    expect(f.find((x) => x.dim === "scan" && x.what.startsWith("No headline"))?.needsFact).toBeUndefined();
  });

  it("keeps the model's needsFact flag", () => {
    const a = finishAnalysis("v1", "Some text here.", { scores: { scan: 5, impact: 5, relevance: 5, honesty: 5, length: 5 }, verdict: "", findings: [{ dim: "impact", line: "", what: "No team size.", why: "x", fix: "Ask me for the team size.", needsFact: true }] }, []);
    expect(a.findings[0].needsFact).toBe(true);
  });
});
