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

  it("names latest-role bullets with no number, and only those", () => {
    const bare = f.filter((x) => x.dim === "impact" && x.line).map((x) => x.line);
    expect(bare).toEqual(["Built the design system site used across the firm.", "Ran design reviews for the platform group."]);
    expect(f.find((x) => x.line === bare[0])!.fix).toMatch(/ask me/);
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
