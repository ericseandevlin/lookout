import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KeywordRow } from "@/lib/application/evidence";
import type { KeywordResult } from "@/lib/interview/keywords";
import { resultLine } from "./KeywordInterview";
import { KeywordSection, keywordTip } from "./KeywordPanel";
import type { Detail } from "./shared";

const row = (term: string, extra: Partial<KeywordRow> = {}): KeywordRow => ({ term, support: null, mine: false, removed: false, used: false, ...extra });
const rows = [
  row("Figma", { support: { line: "Built the Figma library", from: "resume" }, used: true, snippet: "Daily work in Figma." }),
  row("Kubernetes", { snippet: "Must have Kubernetes experience." }),
  row("managing managers", { snippet: "You will be managing managers." }),
  row("tools", { removed: true }),
];
const detail = (interviewKeywords: boolean): Detail =>
  ({ id: "a1", status: "needs_review", report: {}, keywordRows: rows, keywordsApproved: false, keywordPicks: ["managing managers"], interviewKeywords }) as unknown as Detail;
const render = (on: boolean, locked = false) => renderToStaticMarkup(<KeywordSection d={detail(on)} rows={rows} reload={async () => {}} locked={locked} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the keyword panel (#1485)", () => {
  it("with the interview flag off, shows the older panel", () => {
    const html = render(false);
    expect(html).toContain('aria-label="Keywords"');
    expect(html).toContain("Green keywords are backed");
    expect(html).not.toContain("In your resume (");
  });

  it("with the flag on, shows two columns, starred first in Missing, and one x per keyword", () => {
    const t = text(render(true));
    expect(t).toContain("In your resume (1)");
    expect(t).toContain("Missing (2)");
    expect(t.indexOf("managing managers")).toBeLessThan(t.indexOf("Kubernetes"));
    expect(t).toContain("Starred: managing managers");
    expect(t).toContain("Not relevant (1)");
    const html = render(true);
    expect(html).toContain('aria-label="Not relevant: Kubernetes"');
    expect(html).not.toContain("kw-story");
    expect(html).not.toContain("Green keywords are backed");
    expect(t).not.toContain("Nothing is added for a skip");
    // The questions load after the page does.
    expect(t).toContain("Answer to add");
    expect(t).not.toContain("once it knows your experience");
    expect(t).toContain("Use these keywords");
  });

  it("puts the posting quote in the keyword's tooltip, with the line that backs it", () => {
    expect(keywordTip(rows[0])).toBe("Posting: “Daily work in Figma.”\nYour experience: “Built the Figma library”");
    expect(keywordTip(rows[1])).toBe("Posting: “Must have Kubernetes experience.”");
    expect(keywordTip(row("event CRM", { mine: true }))).toBe("You added this one.");
    expect(render(true)).toContain(">Posting: “Must have Kubernetes experience.”</span>");
  });

  it("when locked, has no controls", () => {
    const t = text(render(true, true));
    expect(t).not.toContain("Use these keywords");
    expect(t).not.toContain("Add your own keyword");
    expect(render(true, true)).not.toContain("Not relevant: Kubernetes");
  });
});

describe("what Lookout says after a keyword answer (#1485)", () => {
  const r = (over: Partial<KeywordResult> = {}): KeywordResult => ({ saved: 0, private: 0, backed: [], note: null, ...over });
  it("says what moved, in few words", () => {
    expect(resultLine("I led 3 managers", r({ saved: 2, backed: ["managing managers", "global design team"] }))).toBe("Saved 2 facts. managing managers, global design team move to In your resume.");
    expect(resultLine("I did", r({ saved: 1, private: 1 }))).toBe("Saved 1 fact. 1 kept private.");
  });
  it("lets a follow-up speak for itself, with no dead end", () => {
    expect(resultLine("yes", r({ followUp: "Where was that?" }))).toBeNull();
    expect(resultLine("At Acme, 3 managers", r({ saved: 1, followUp: "How many people in all?" }))).toBe("Saved 1 fact.");
  });
  it("keeps a no short, and never says the same line twice in a row", () => {
    expect(resultLine("no", r({ declined: true }))).toBe("Got it. Marked not relevant.");
    expect(resultLine("nope", r({ declined: true }), "Got it. Marked not relevant.")).toBe("Noted. Not relevant.");
    expect(resultLine(null, r())).toBe("Skipped.");
    expect(resultLine(null, r(), "Skipped.")).toBe("Skipped. Next one.");
    expect(resultLine("hmm", r())).toBe("Thanks.");
  });
});
