import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KeywordRow } from "@/lib/application/evidence";
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
    // One interview: the Missing column links to the interview page for this application.
    expect(html).toContain('data-tip="A short interview adds missing keywords."');
    expect(html).toContain('href="/interview?app=');
    expect(t).toContain("Interview me");
    expect(t).toContain("Use these keywords");
  });

  it("puts Missing first, keeps the card as the final list, and the add box behind an icon (#1665)", () => {
    const html = render(true);
    const t = text(html);
    expect(t.indexOf("Missing (2)")).toBeLessThan(t.indexOf("In your resume (1)"));
    // The go sits inside the card, after the resume's keywords.
    expect(t.indexOf("In your resume (1)")).toBeLessThan(t.indexOf("Use these keywords"));
    expect(t).not.toContain("Final list");
    expect(html).toContain('aria-label="Add your own keyword"');
    expect(html).not.toContain('id="kw-add"');
    // Interview me is secondary; the one red button is the go.
    expect(html).toMatch(/<a[^>]*data-tip="A short interview adds missing keywords\."[^>]*>/);
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
