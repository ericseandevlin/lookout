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
const letter: Item = {
  id: "i2",
  kind: "cover_letter",
  prompt: "Cover letter",
  required: true,
  fieldType: null,
  options: null,
  question: null,
  approvedVersionId: null,
  versions: [{ id: "v1", version: 1, content: "Dear Hiring Team,\n\nI am writing to apply for the Design Engineer role.", note: "", author: "ai", sources: [], createdAt: "2026-11-16T00:00:00Z" }],
};
const card = (needsKeywords: boolean) =>
  renderToStaticMarkup(
    <ItemCard appId="a1" item={resume} locked={false} act={async () => true} template="classic" accent={null} header={null} onTemplate={() => {}} onAccent={() => {}} needsKeywords={needsKeywords} />,
  );
const letterCard = (interview: boolean) =>
  renderToStaticMarkup(
    <ItemCard appId="a1" item={letter} locked={false} act={async () => true} interview={interview} template="classic" accent={null} header={null} onTemplate={() => {}} onAccent={() => {}} />,
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

describe("the chat revise box and the last button (#1665)", () => {
  it("has no Revise button; the ask box sends with the interview's send control", () => {
    const html = card(false);
    expect(html).not.toContain(">Revise<");
    expect(html).toContain('aria-label="Send"');
    expect(html).toContain("Ask Lookout to update your resume");
  });

  it("opens the letter's box with the top fix, ready to send", () => {
    const html = letterCard(false);
    expect(html).toContain("Replace the opening line with one sentence that ties my strongest result to what this team needs, from the posting.");
    expect(html).toContain("Ask Lookout to update your letter");
  });

  it("links to the interview for a richer letter only when the interview feature is on", () => {
    expect(letterCard(true)).toContain('href="/interview?app=a1"');
    expect(letterCard(true)).toContain("Tell Lookout more for a richer letter");
    expect(letterCard(false)).not.toContain('href="/interview?app=a1"');
  });

  it("keeps Approve as the last button, right-aligned after the chat box", () => {
    const html = card(false);
    expect(html).toContain("Approve v1");
    expect(html.indexOf('aria-label="Send"')).toBeLessThan(html.indexOf("Approve v1"));
    expect(html.indexOf("justify-content:flex-end")).toBeGreaterThan(-1);
    expect(html.indexOf("justify-content:flex-end")).toBeLessThan(html.indexOf("Approve v1"));
  });

  it("says in few words when each letter strategy is the better choice", () => {
    const html = renderToStaticMarkup(
      <ItemCard
        appId="a1"
        item={letter}
        locked={false}
        act={async () => true}
        template="classic"
        accent={null}
        header={null}
        letter={{ strategy: "match", ready: ["match", "proof", "why"], writing: false, suggested: "match", why: "The posting lists clear must-haves." }}
        onTemplate={() => {}}
        onAccent={() => {}}
      />,
    );
    expect(html).toContain("For senior roles, or a standout result.");
    expect(html).toContain("When the posting lists hard asks.");
    expect(html).toContain("When you have a real reason to care.");
    expect(html).toContain(" · suggested");
  });

  it("shows Unapprove in place of Approve once a version is approved", () => {
    const html = renderToStaticMarkup(
      <ItemCard appId="a1" item={{ ...resume, approvedVersionId: "v1" }} locked={false} act={async () => true} template="classic" accent={null} header={null} onTemplate={() => {}} onAccent={() => {}} />,
    );
    expect(html).toContain("Unapprove");
    expect(html).not.toContain("Approve v1");
  });
});
