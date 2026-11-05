import { describe, expect, it } from "vitest";
import { autoApproveField, optionAnswerAllowed, settledStatus, statusAfterFill } from "./flowRules";

const approved = { required: true, approvedVersionId: "version-1" };

describe("settledStatus", () => {
  it("keeps an empty application in review", () => {
    expect(settledStatus("browser", [], true)).toBe("needs_review");
  });

  it("keeps required items without an approved version in review", () => {
    expect(settledStatus("browser", [approved, { required: true, approvedVersionId: null }], true)).toBe("needs_review");
  });

  it("does not wait for optional items", () => {
    expect(settledStatus("browser", [approved, { required: false, approvedVersionId: null }], true)).toBe("approved");
  });

  it("approves a ready browser application only when automatic submit is on", () => {
    expect(settledStatus("browser", [approved], true)).toBe("approved");
    expect(settledStatus("browser", [approved], false)).toBe("manual");
  });

  it("uses the manual checklist for non-browser routes", () => {
    expect(settledStatus("api", [approved], true)).toBe("manual");
    expect(settledStatus("manual", [approved], true)).toBe("manual");
    expect(settledStatus(null, [approved], true)).toBe("manual");
  });
});

describe("optionAnswerAllowed", () => {
  it("allows any answer when the item has no options", () => {
    expect(optionAnswerAllowed(null, "Free text")).toBe(true);
    expect(optionAnswerAllowed([], "Free text")).toBe(true);
  });

  it("allows clearing a choice", () => {
    expect(optionAnswerAllowed(["Yes", "No"], "")).toBe(true);
  });

  it("accepts only an exact form option", () => {
    expect(optionAnswerAllowed(["Yes", "No"], "Yes")).toBe(true);
    expect(optionAnswerAllowed(["Yes", "No"], "Maybe")).toBe(false);
    expect(optionAnswerAllowed(["Yes", "No"], "yes")).toBe(false);
    expect(optionAnswerAllowed(["Yes", "No"], "Yes ")).toBe(false);
  });
});

describe("autoApproveField", () => {
  it("auto-approves a basic field with a non-blank answer", () => {
    expect(autoApproveField("field", "10001")).toBe(true);
  });

  it("does not auto-approve a blank field", () => {
    expect(autoApproveField("field", "  \n")).toBe(false);
  });

  it("does not auto-approve documents or long answers", () => {
    expect(autoApproveField("answer", "My answer")).toBe(false);
    expect(autoApproveField("resume", "My resume")).toBe(false);
  });
});

describe("statusAfterFill", () => {
  it("marks an application submitted only after confirmation", () => {
    expect(statusAfterFill({ confirmation: "Application received" })).toBe("submitted");
    expect(statusAfterFill({})).toBe("manual");
  });

  it("treats an empty confirmation as a confirmation, but a stop reason as manual", () => {
    expect(statusAfterFill({ confirmation: "" })).toBe("submitted");
    expect(statusAfterFill({ confirmation: "Application received", stopped: "Check the result" })).toBe("manual");
  });
});
