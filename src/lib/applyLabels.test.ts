import { describe, expect, it } from "vitest";
import { APPLICATION_STATUSES } from "./db/schema";
import { anyApplying, applicationLabel } from "./applyLabels";

describe("applicationLabel", () => {
  it("has a label and colors for every status", () => {
    for (const s of APPLICATION_STATUSES) {
      const l = applicationLabel(s, "user");
      expect(l.label, s).toBeTruthy();
      expect(l.bg, s).toMatch(/^#[0-9A-F]{6}$/i);
      expect(l.ink, s).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("says who queued it", () => {
    expect(applicationLabel("queued", "user").label).toBe("Queued");
    expect(applicationLabel("queued", "auto").label).toBe("Auto-queued");
    expect(applicationLabel("submitted", "auto").label).toBe("Applied");
  });
});

describe("anyApplying", () => {
  const f = (status: (typeof APPLICATION_STATUSES)[number] | null) => ({ application: status ? { status } : null });
  it("is true while Lookout still works on an application (#1662)", () => {
    expect(anyApplying([f(null), f("scanning")])).toBe(true);
    expect(anyApplying([f("queued")])).toBe(true);
    expect(anyApplying([f("drafting")])).toBe(true);
  });
  it("is false once every application waits on the person or is done", () => {
    expect(anyApplying([f(null), f("needs_review"), f("submitted"), f("failed")])).toBe(false);
    expect(anyApplying([])).toBe(false);
  });
});
