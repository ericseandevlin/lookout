import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemCard, letterFix } from "./ItemCard";
import type { Item } from "./shared";

const resume: Item = {
  id: "i1",
  kind: "resume",
  prompt: "Resume",
  required: true,
  fieldType: null,
  options: null,
  question: null,
  approvedVersionId: null,
  versions: [{ id: "v1", version: 1, content: "# Ada Park\nDesign engineer\n## Experience\n- Built things", note: "", author: "ai", sources: [], createdAt: "2026-11-16T00:00:00Z" }],
};
const card = (needsKeywords: boolean) =>
  renderToStaticMarkup(
    <ItemCard appId="a1" item={resume} locked={false} act={async () => true} template="classic" accent={null} header={null} onTemplate={() => {}} onAccent={() => {}} needsKeywords={needsKeywords} />,
  );

describe("resume Redraft before keywords are approved (#1334)", () => {
  it("disables Redraft and says to approve the keywords, with a link to them", () => {
    const html = card(true);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Redraft from the posting \(approve the keywords first\)"/);
    expect(html).toContain('href="#keywords"');
    expect(html).toContain("Use these keywords");
  });

  it("leaves Redraft alone once keywords are approved", () => {
    const html = card(false);
    expect(html).toContain('aria-label="Redraft from the posting"');
    expect(html).not.toContain('href="#keywords"');
  });
});

describe("revising and approving (#1665)", () => {
  const letter: Item = { ...resume, id: "i2", kind: "cover_letter", prompt: "Cover letter", versions: [{ ...resume.versions[0], id: "v2", content: "Dear Team,\n\nI am excited to apply for this role.\n\nI grew Acme's design system to 40 teams.\n\nBest,\nAda" }] };
  const render = (item: Item, interviewHref: string | null = null) =>
    renderToStaticMarkup(<ItemCard appId="a1" item={item} locked={false} act={async () => true} template="classic" accent={null} header={null} onTemplate={() => {}} onAccent={() => {}} interviewHref={interviewHref} />);

  it("has a chat input with a send icon, no Revise button and no Recruiter Analysis, and Approve last", () => {
    const html = render(resume);
    expect(html).toContain('placeholder="Ask Lookout to update your resume"');
    expect(html).toContain('aria-label="Send"');
    expect(html).not.toContain(">Revise<");
    expect(html).not.toContain("Recruiter Analysis");
    expect(html.slice(html.lastIndexOf("<button"))).toContain("Approve v1");
  });

  it("prefills the cover letter's input with its top fix, and offers the interview beside it", () => {
    const fix = letterFix("cover_letter", letter.versions[0].content);
    expect(fix).toMatch(/^Replace the opening line/);
    const html = render(letter, "/interview?app=a1");
    expect(html).toContain(`>${fix}</textarea>`);
    expect(html).toContain('href="/interview?app=a1"');
    expect(letterFix("resume", resume.versions[0].content)).toBe("");
  });
});
