import { describe, expect, it } from "vitest";
import { searchBlocker } from "./ready";

describe("searchBlocker", () => {
  it("asks for the answers first", () => {
    expect(searchBlocker(3, "done")?.text).toBe("Answer the 5 profile questions to search");
    expect(searchBlocker(0, null)?.text).toBe("Answer the 5 profile questions to search");
  });
  it("then asks for a resume", () => {
    expect(searchBlocker(5, null)).toEqual({ text: "Add your resume to search", href: "/profile/materials" });
    expect(searchBlocker(5, "failed")?.text).toBe("Add your resume to search");
    expect(searchBlocker(5, "scanning")?.text).toBe("Lookout is still reading your resume");
  });
  it("lets a finished profile search", () => {
    expect(searchBlocker(5, "done")).toBeNull();
  });
});
