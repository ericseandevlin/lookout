import { describe, expect, it } from "vitest";
import { contactParts, humanize, parseDraft, splitRole, toPlain } from "./resumeLayout";

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
      { t: "headline", text: "UX Engineer | Design Systems Lead" },
      { t: "contact", text: "New York, NY • maya@example.com • 646.555.0100" },
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

describe("contactParts", () => {
  it("makes email, phone, site and LinkedIn into links, leaves the city as text", () => {
    expect(contactParts("New York, NY • ericdevlin@me.com • 646.555.0100 • ericdevlin.co • linkedin.com/in/ericseandev")).toEqual([
      { text: "New York, NY" },
      { text: "ericdevlin@me.com", href: "mailto:ericdevlin@me.com" },
      { text: "646.555.0100", href: "tel:6465550100" },
      { text: "ericdevlin.co", href: "https://ericdevlin.co" },
      { text: "linkedin.com/in/ericseandev", href: "https://linkedin.com/in/ericseandev" },
    ]);
  });
});

describe("header order", () => {
  it("puts the headline right under the name even when the draft lists contact first", () => {
    const b = parseDraft("# Eric Devlin\nNew York, NY • ericdevlin@me.com\nUX Engineering Lead\n## Summary\nShips things.");
    expect(b.slice(0, 3).map((x) => x.t)).toEqual(["name", "headline", "contact"]);
  });
});

import { contrastOnWhite, readable, styleFor } from "./resumeLayout";

describe("grouped roles", () => {
  it("reads titles under one employer heading", () => {
    const b = parseDraft("## Experience\n### RPM | New York, NY | 07/2017 – 07/2021\n#### Web Development Team Lead | 11/2018 – 07/2021\n- Led a team of five.\n#### Developer | 01/2018 – 11/2018");
    expect(b.map((x) => [x.t, x.t === "role" || x.t === "subrole" ? x.right : undefined])).toEqual([
      ["section", undefined],
      ["role", "07/2017 – 07/2021"],
      ["subrole", "11/2018 – 07/2021"],
      ["bullet", undefined],
      ["subrole", "01/2018 – 11/2018"],
    ]);
  });
});

describe("highlight color", () => {
  it("keeps readable colors and darkens light ones to 4.5:1 on white", () => {
    expect(readable("C2410C")).toBe("C2410C");
    expect(contrastOnWhite(readable("#FFD54F"))).toBeGreaterThanOrEqual(4.5);
    expect(readable("nonsense")).toBe("C2410C");
  });

  it("applies only to Cool", () => {
    expect(styleFor("cool", "4338CA").accent).toBe("4338CA");
    expect(styleFor("modern", "4338CA").accent).toBe("2F4A5C");
  });
});
