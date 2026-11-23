import { describe, expect, it } from "vitest";
import { approvalLeft } from "./shared";

describe("the review page says what's left in plain words (#1664)", () => {
  const item = (kind: string, required: boolean, approved = false) => ({ kind, required, approvedVersionId: approved ? "v" : null });

  it("names each part still waiting for approval", () => {
    expect(approvalLeft([item("resume", true), item("cover_letter", true)])).toEqual(["the resume", "the cover letter"]);
  });

  it("counts repeats instead of repeating the name", () => {
    expect(approvalLeft([item("answer", true), item("answer", true), item("field", true)])).toEqual(["2 questions", "one field"]);
  });

  it("leaves out approved and optional parts", () => {
    expect(approvalLeft([item("resume", true, true), item("answer", false), item("field", true, true)])).toEqual([]);
  });
});
