import { describe, expect, it } from "vitest";
import type { ApplicationReport } from "@/lib/db/schema";
import { approvedBlock, approvedFor, finalTerms, keywordPicks, keywordRows, planFrom, postingSnippet, supportFor, unapprovedIn, type KeywordRow } from "./evidence";
import { upsertNote } from "./skills";

const posting = `Role: Design Engineer
Company: Acme

About the role. You will build design systems with React and TypeScript. Experience with Kubernetes is a plus.
- Partner with product on accessibility audits.`;
const resume = `# Pat Lee
## Experience
### Lead, Acme | 01/2020 – Present
- Built the firm's design systems site in React, used by 40 teams
- Ran WCAG accessibility audits across 12 products
## Skills
- TypeScript, Figma`;

const report = (r: Partial<ApplicationReport> = {}): ApplicationReport => ({ keywordPlan: [{ term: "design systems" }, { term: "Kubernetes" }, { term: "accessibility audits", cite: "Ran WCAG accessibility audits across 12 products" }, { term: "TypeScript" }], ...r });

describe("keyword evidence (#121)", () => {
  it("keeps only real posting terms from the model's proposal", () => {
    const plan = planFrom({ keywords: [{ term: "React", experience: "" }, { term: "react", experience: "" }, { term: "Blockchain", experience: "x" }, { term: "TypeScript", experience: "TypeScript, Figma" }] }, posting);
    expect(plan).toEqual([{ term: "React" }, { term: "TypeScript", cite: "TypeScript, Figma" }]);
  });

  it("shows the posting sentence each keyword came from, never the facts header", () => {
    expect(postingSnippet(posting, "React")).toBe("You will build design systems with React and TypeScript.");
    expect(postingSnippet(posting, "accessibility audits")).toBe("Partner with product on accessibility audits.");
    expect(postingSnippet(posting, "Design Engineer")).toBeUndefined();
  });

  it("pairs each keyword with the person's own line, and marks the rest unsupported", () => {
    const rows = keywordRows(report(), posting, resume, []);
    const by = (t: string) => rows.find((r) => r.term === t)!;
    expect(by("design systems").support).toEqual({ line: "Built the firm's design systems site in React, used by 40 teams", from: "resume" });
    expect(by("design systems").snippet).toMatch(/build design systems/);
    expect(by("Kubernetes")).toMatchObject({ support: null, used: false });
    expect(finalTerms(rows)).toEqual(["design systems", "accessibility audits", "TypeScript"]);
  });

  it("only trusts a cited line that is really in the resume or notes", () => {
    expect(supportFor("Kubernetes", "Ran Kubernetes clusters for 5 years", resume, [])).toBeNull();
    expect(supportFor("people leadership", "Ran WCAG accessibility audits across 12 products", resume, [])).toEqual({ line: "Ran WCAG accessibility audits across 12 products", from: "resume" });
  });

  it("a note without details is not evidence; a note with details is", () => {
    expect(supportFor("Kubernetes", undefined, resume, upsertNote([], "Kubernetes", ""))).toBeNull();
    expect(supportFor("Kubernetes", undefined, resume, upsertNote([], "kubernetes", "Run the k3s cluster for my side project"))).toEqual({ line: "Run the k3s cluster for my side project", from: "notes" });
  });

  it("the person can remove any keyword and add their own", () => {
    const rows = keywordRows(report({ keywordChoices: { include: ["Figma"], exclude: ["TypeScript"] } }), posting, resume, []);
    expect(rows.find((r) => r.term === "TypeScript")).toMatchObject({ removed: true, used: false });
    expect(rows.find((r) => r.term === "Figma")).toMatchObject({ mine: true, used: true, snippet: undefined });
    expect(finalTerms(rows)).toEqual(["design systems", "accessibility audits", "Figma"]);
  });

  it("edits to notes count the next time keywords are chosen", () => {
    const r = report();
    expect(finalTerms(keywordRows(r, posting, resume, []))).not.toContain("Kubernetes");
    expect(finalTerms(keywordRows(r, posting, resume, upsertNote([], "Kubernetes", "Run a k3s cluster")))).toContain("Kubernetes");
  });

  it("the go holds only for the exact list it was given for", () => {
    const rows = keywordRows(report(), posting, resume, []);
    expect(approvedFor(report(), rows)).toBe(false);
    const ok = report({ keywordsApproved: { terms: finalTerms(rows), at: "2026-10-26" } });
    expect(approvedFor(ok, rows)).toBe(true);
    const changed = keywordRows({ ...ok, keywordChoices: { include: [], exclude: ["design systems"] } }, posting, resume, []);
    expect(approvedFor(ok, changed)).toBe(false);
  });

  it("tells the model exactly the approved terms with their lines, and bans the rest", () => {
    const b = approvedBlock(keywordRows(report(), posting, resume, []));
    expect(b).toContain("- design systems (backed by: Built the firm's design systems site in React, used by 40 teams)");
    expect(b).toMatch(/Do not work in any other posting keyword\. Never use these: Kubernetes\./);
    expect(b).not.toMatch(/- Kubernetes/);
  });

  it("flags unapproved terms a draft carries that the resume doesn't", () => {
    const rows = keywordRows(report(), posting, resume, []);
    expect(unapprovedIn("Led Kubernetes rollouts and design systems", resume, rows)).toEqual(["Kubernetes"]);
  });
});

describe("keywordPicks (#738)", () => {
  const row = (term: string, o: Partial<KeywordRow> = {}): KeywordRow => ({ term, support: null, mine: false, removed: false, used: false, ...o });
  const posting = "Design Systems Engineer. You will own our design systems. Required: React and TypeScript. Design systems experience is a must. Nice to have: Figma.";

  it("picks unbacked keywords the posting leans on, most first, at most three", () => {
    const rows = [row("Figma"), row("design systems"), row("React", { snippet: "Required: React and TypeScript." }), row("TypeScript", { support: { line: "Built it in TypeScript", from: "resume" }, used: true })];
    expect(keywordPicks(rows, posting, "Design Systems Engineer")).toEqual(["design systems", "React"]);
  });

  it("recommends none when nothing stands out", () => {
    expect(keywordPicks([row("Figma")], posting, "Engineer")).toEqual([]);
  });

  it("skips removed keywords", () => {
    expect(keywordPicks([row("design systems", { removed: true })], posting, "Design Systems Engineer")).toEqual([]);
  });
});
