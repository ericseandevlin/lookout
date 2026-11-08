import { describe, expect, it } from "vitest";
import { APPLICATION_STATUSES } from "./db/schema";
import { applicationLabel } from "./applyLabels";

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
