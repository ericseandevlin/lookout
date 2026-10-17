import { describe, expect, it } from "vitest";
import { humanize, parseDraft, splitRole, toPlain } from "./resumeLayout";

const md = `# Maya Ortiz
New York, NY • maya@example.com • 646.555.0100
UX Engineer | Design Systems Lead

## Summary
Leads design systems — and the teams that build them.

## Experience
### UX Engineering Lead, Acme | New York, NY | 07/2021 – Present
- Built the **design system** site used across the firm.
### Front-End Developer, Studio — 2016 — 2021
- Shipped *fast* sites.`;

describe("parseDraft", () => {
  it("reads name, contact lines, sections, roles with dates, bullets", () => {
    expect(parseDraft(md)).toEqual([
      { t: "name", text: "Maya Ortiz" },
      { t: "contact", text: "New York, NY • maya@example.com • 646.555.0100" },
      { t: "contact", text: "UX Engineer | Design Systems Lead" },
      { t: "section", text: "Summary" },
      { t: "text", text: "Leads design systems, and the teams that build them." },
      { t: "section", text: "Experience" },
      { t: "role", text: "UX Engineering Lead, Acme | New York, NY", right: "07/2021 – Present" },
      { t: "bullet", text: "Built the design system site used across the firm." },
      { t: "role", text: "Front-End Developer, Studio", right: "2016 – 2021" },
      { t: "bullet", text: "Shipped fast sites." },
    ]);
  });

  it("never leaves an em dash", () => {
    expect(humanize("Lead — Citi — 2021—Present")).toBe("Lead, Citi, 2021 – Present");
    expect(JSON.stringify(parseDraft(md))).not.toContain("—");
  });

  it("splits dates off role lines", () => {
    expect(splitRole("Designer, Coach | Jan 2010 – Mar 2015")).toEqual({ text: "Designer, Coach", right: "Jan 2010 – Mar 2015" });
    expect(splitRole("Designer, Coach")).toEqual({ text: "Designer, Coach" });
  });

  it("gives plain text with no markup", () => {
    const t = toPlain(md);
    expect(t).not.toMatch(/[#*]/);
    expect(t).toContain("EXPERIENCE");
    expect(t).toContain("• Built the design system site used across the firm.");
  });
});
