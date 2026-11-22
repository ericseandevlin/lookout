import { describe, expect, it } from "vitest";
import type { ApplicationReport } from "@/lib/db/schema";
import { approvedBlock, approvedFor, finalTerms, KEYWORD_CAP, keywordPicks, keywordPlanPrompt, keywordRows, planFrom, postingSnippet, supportFor, trimRows, unapprovedIn, type KeywordRow } from "./evidence";
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
    // A posting stored as JSON-escaped HTML quotes as clean text (#1481).
    const escaped = "end-to-end ownership, and product excellence.\\u003c/li\\u003e\\n\\u003cli\\u003eStrong customer advocacy, with design decisions grounded in data.\\u003c/li\\u003e";
    expect(postingSnippet(escaped, "customer advocacy")).toBe("Strong customer advocacy, with design decisions grounded in data.");
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

  it("a short resume line inside a made-up cite is not backing (#1627)", () => {
    const skills = "## Skills\n- User research\n- Figma";
    expect(supportFor("accessibility audits", "Ran accessibility audits and user research across three products", skills, [])).toBeNull();
    // A cite that is the line plus a little extra still counts.
    expect(supportFor("people leadership", "- Ran WCAG accessibility audits across 12 products.", resume, [])).toEqual({ line: "Ran WCAG accessibility audits across 12 products", from: "resume" });
    expect(supportFor("people leadership", "Acme: Ran WCAG accessibility audits across 12 products", resume, [])).toEqual({ line: "Ran WCAG accessibility audits across 12 products", from: "resume" });
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

describe("postingSnippet window (#1314)", () => {
  const long = `Job expectations include familiarity with at least one area of engineering, acting as a go to reference across the organization, and applying knowledge to improve technical competencies through recruitment and development activities.</p><p><b>Position Summary:</b></p><p>This job is responsible for defining and leading the engineering approach and strategy for AI solutions across ${"the wider program and portfolio of solutions ".repeat(8)}for Global Markets Regulatory Reporting, to deliver significant business outcomes`;
  it("shows the term even when it sits far into a long passage", () => {
    for (const term of ["Regulatory Reporting", "Global Markets"]) {
      const q = postingSnippet(long, term)!;
      expect(q).toContain(term);
      expect(q.startsWith("…")).toBe(true);
      expect(q.length).toBeLessThanOrEqual(221);
    }
  });
  it("starts at the passage when the term is near the front", () => {
    const q = postingSnippet(long, "Job expectations")!;
    expect(q.startsWith("Job expectations")).toBe(true);
    expect(q.endsWith("…")).toBe(true);
  });
  it("cuts around the term as a whole word, not a piece of an earlier word (#1368)", () => {
    const filler = "and partner closely with product, design and data science on a roadmap that spans many teams ".repeat(2);
    const sql = `You will own our PostgreSQL clusters ${filler}and write SQL every day.`;
    expect(sql.length).toBeGreaterThan(220);
    expect(postingSnippet(sql, "SQL")).toMatch(/\bSQL\b/);
    expect(postingSnippet(`You will maintain the platform ${filler}and ship AI features to customers.`, "AI")).toMatch(/\bAI\b/);
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

describe("keywordPicks: short skills count only as their own word (#1377)", () => {
  const row = (term: string, snippet?: string): KeywordRow => ({ term, snippet, support: null, mine: false, removed: false, used: false });

  it.each([
    ["Go", "You will build backend services in Go.\nPartner with our go-to-market team on go-to-market launches."],
    ["R", "Analyze experiments in R.\nWork with R&D and present to R&D leads."],
    ["C", "Firmware in C.\nTooling in C++ and C#."],
  ])("%s named once is not a pick", (term, posting) => {
    expect(keywordPicks([row(term, posting.split("\n")[0])], posting, "Engineer")).toEqual([]);
  });

  it("Go named twice as its own word still is", () => {
    const posting = "You will build services in Go.\nWe write Go and some Python.";
    expect(keywordPicks([row("Go", "You will build services in Go.")], posting, "Backend Engineer")).toEqual(["Go"]);
  });
});

describe("a shorter keyword list (#1485)", () => {
  const row = (term: string, extra: Partial<KeywordRow> = {}): KeywordRow => ({ term, support: null, mine: false, removed: false, used: false, ...extra });
  const posting = Array.from({ length: 20 }, (_, i) => `skill ${i}`).join(", ") + ", tools, craft, portfolio.";

  it("caps a new plan at 12 and drops generic single words", () => {
    const terms = ["tools", "craft", ...Array.from({ length: 20 }, (_, i) => `skill ${i}`), "portfolio"];
    const plan = planFrom({ keywords: terms.map((term) => ({ term, experience: "" })) }, posting);
    expect(plan).toHaveLength(KEYWORD_CAP);
    expect(plan.map((p) => p.term)).toEqual(Array.from({ length: 12 }, (_, i) => `skill ${i}`));
  });

  it("trims an older long list to 12, keeping the person's own keywords and the starred picks", () => {
    const rows = [row("tools"), ...Array.from({ length: 20 }, (_, i) => row(`skill ${i}`)), row("portfolio"), row("my own thing", { mine: true })];
    const out = trimRows(rows, ["skill 18", "skill 19"], posting);
    expect(out).toHaveLength(12);
    expect(out.map((r) => r.term)).toEqual([...Array.from({ length: 9 }, (_, i) => `skill ${i}`), "skill 18", "skill 19", "my own thing"]);
  });

  it("leaves a short list alone", () => {
    const rows = [row("Figma"), row("accessibility")];
    expect(trimRows(rows, [], "Figma and accessibility")).toEqual(rows);
  });
});

describe("keywords come from the posting's own text (#1531)", () => {
  const posting = "Role: Senior Product Designer\nCompany: Acme\nLocation: New York\nWork mode: Remote\n\nSenior Product Designer\nYou will own the booking flow on iOS and Android.\nMust have design systems experience and user research.";
  const row = (term: string, extra: Partial<KeywordRow> = {}): KeywordRow => ({ term, support: null, mine: false, removed: false, used: false, ...extra });

  it("drops the title and the fact lines from a new plan", () => {
    const plan = planFrom({ keywords: ["Senior Product Designer", "Product Designer", "Remote", "design systems", "user research", "iOS"].map((term) => ({ term, experience: "" })) }, posting);
    expect(plan.map((p) => p.term)).toEqual(["design systems", "user research", "iOS"]);
  });

  it("drops them from an older list too, even when starred, but keeps the person's own", () => {
    const rows = [row("Remote"), row("Product Designer"), row("design systems"), row("Remote work", { mine: true })];
    expect(trimRows(rows, ["Remote"], posting).map((r) => r.term)).toEqual(["design systems", "Remote work"]);
  });

  it("gives the model the title as context and the posting body to pick from", () => {
    const p = keywordPlanPrompt(posting, "resume", "");
    expect(p).toContain("<job_title context only, not a keyword>\nSenior Product Designer\n</job_title>");
    expect(p).not.toContain("Work mode: Remote");
    expect(p).toContain("Must have design systems experience");
  });

  it("lets a fact the interview saved back a keyword", () => {
    expect(supportFor("design systems", undefined, "Resume without it", [], ["Built the design systems library for 3 apps"])).toEqual({ line: "Built the design systems library for 3 apps", from: "notes" });
    expect(supportFor("Kubernetes", undefined, "Resume", [], ["Built the design systems library"])).toBeNull();
  });
});
