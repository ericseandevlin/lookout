import { describe, expect, it } from "vitest";
import { askedInBox, sectionItems } from "./ApplicationReview";

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

describe("a resume or letter with a question stays on the page (#1662)", () => {
  const items = [
    { id: "r", kind: "resume", question: 'This draft uses "close processes", which you didn\'t approve. Remove it or add the experience behind it first.' },
    { id: "l", kind: "cover_letter", question: "Check the opening." },
    { id: "a", kind: "answer", question: "What is your LinkedIn URL?" },
  ];
  it("keeps the resume and letter in their sections", () => {
    expect(sectionItems(items, ["resume"], false).map((i) => i.id)).toEqual(["r"]);
    expect(sectionItems(items, ["cover_letter"], false).map((i) => i.id)).toEqual(["l"]);
  });
  it("asks only form answers in the box, so no answer can replace a draft", () => {
    expect(items.filter(askedInBox).map((i) => i.id)).toEqual(["a"]);
  });
});
