import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemCard } from "./ItemCard";
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
