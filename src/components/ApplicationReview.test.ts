import { describe, expect, it } from "vitest";
import { reviewSteps, sectionItems } from "./ApplicationReview";
import type { Item } from "./review/shared";

describe("the review page asks each question once (#1531)", () => {
  const items = [
    { id: "a", kind: "answer", question: "Your materials don't include a LinkedIn URL. What is it?" },
    { id: "b", kind: "answer", question: null },
    { id: "c", kind: "field", question: null },
  ];
  it("leaves an item waiting on an answer to the box at the top", () => {
    expect(sectionItems(items, ["answer", "portfolio"], false).map((i) => i.id)).toEqual(["b"]);
  });
  it("shows everything once it's sent", () => {
    expect(sectionItems(items, ["answer", "portfolio"], true).map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("what's left on the review page (#1664)", () => {
  const item = (id: string, kind: string, extra: Partial<Item> = {}): Item => ({ id, kind, prompt: `Prompt ${id}`, required: true, fieldType: null, options: null, question: null, approvedVersionId: null, versions: [], ...extra });
  const items = [
    item("r", "resume", { approvedVersionId: "v1" }),
    item("c", "cover_letter"),
    item("q", "answer", { question: "What is your LinkedIn URL?" }),
    item("o", "answer", { required: false }),
    item("e", "eeo"),
  ];
  it("lists the keywords first, then each required item, and points an open question at the questions box", () => {
    expect(reviewSteps({ keywordRows: [], keywordsApproved: false, items })).toEqual([
      { label: "Keywords", done: false, href: "#keywords" },
      { label: "Resume", done: true, href: "#item-r" },
      { label: "Cover letter", done: false, href: "#item-c" },
      { label: "Prompt q", done: false, href: "#qs" },
    ]);
  });
  it("leaves the keywords out when the application has none", () => {
    expect(reviewSteps({ keywordRows: null, keywordsApproved: false, items }).map((s) => s.label)).toEqual(["Resume", "Cover letter", "Prompt q"]);
  });
});
