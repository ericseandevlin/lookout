import { describe, expect, it } from "vitest";
import { sectionItems } from "./ApplicationReview";

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
