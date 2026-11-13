import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { draftToDocx } from "./docx";
import { agencyWording, parseDraft, shapeResume } from "./resumeLayout";

// The way a model tends to write it: RPM three times, two short freelance gigs, an agency contract
// written the agency's way, and a branding job inside the Citi years.
const messy = `# Eric Devlin
UX Engineering Lead
New York, NY • ericdevlin@me.com

## Summary
Builds design systems that ship.

## Experience
### Vice President, Citi | New York, NY | 01/2025 – Present
- Leads UX engineering.
### Freelance Brand Designer, Studio Nine | New York, NY | 03/2024 – 09/2024
- Branding for a studio.
### UX Engineering Lead, Photon (client: Citi) | New York, NY | 06/2021 – 12/2024
- Built the design system.
### Senior Developer, RPM | New York, NY | 01/2019 – 05/2021
- Led the web team.
### Developer, RPM | New York, NY | 01/2017 – 12/2018
- Shipped sites.
### Junior Developer, RPM | New York, NY | 06/2016 – 12/2016
- Learned the stack.
### Freelance Web Developer, Weather Company | 01/2015 – 06/2015
- Weather pages.
### Freelance Developer, Computer Lunch | 07/2015 – 05/2016
- Game prototypes.

## Education
BFA, Parsons`;

/** Paragraph text and the color of its first run, in order, from the .docx a recruiter opens. */
async function rendered(md: string, accent?: string) {
  const zip = await JSZip.loadAsync(await draftToDocx(md, "Resume", { template: "cool", accent }));
  const xml = await zip.file("word/document.xml")!.async("string");
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(([p]) => ({
    text: [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>/g)].map((m) => m[1] ?? "\t").join(""),
    color: p.match(/<w:color w:val="([0-9A-F]{6})"/)?.[1],
  }));
}

describe("Experience shape in code (#137)", () => {
  const r = shapeResume(messy);

  it("puts each employer's titles under one heading, newest first", () => {
    const b = parseDraft(r.md);
    expect(b.filter((x) => x.t === "role" && /RPM/.test(x.text))).toEqual([{ t: "role", text: "RPM | New York, NY", right: "06/2016 – 05/2021" }]);
    const i = b.findIndex((x) => x.t === "role" && x.text.startsWith("RPM"));
    expect(b.slice(i + 1).filter((x) => x.t === "subrole").slice(0, 3).map((x) => x.text)).toEqual(["Senior Developer", "Developer", "Junior Developer"]);
  });

  it("writes agency contracts the recruiter way and keeps them with the brand", () => {
    expect(agencyWording("UX Engineering Lead, Photon (client: Citi)")).toBe("UX Engineering Lead (contract via Photon), Citi");
    expect(agencyWording("UX Engineering Lead, Citi (via Photon)")).toBe("UX Engineering Lead (contract via Photon), Citi");
    expect(agencyWording("UX Engineering Lead (contract via Photon), Citi")).toBe("UX Engineering Lead (contract via Photon), Citi");
    const b = parseDraft(r.md);
    expect(b.filter((x) => x.t === "role" && /Citi/.test(x.text))).toEqual([{ t: "role", text: "Citi | New York, NY", right: "06/2021 – Present" }]);
    expect(b.filter((x) => x.t === "subrole").slice(0, 2).map((x) => x.text)).toEqual(["Vice President", "UX Engineering Lead (contract via Photon)"]);
  });

  it("shows freelance once, as an umbrella with the clients named", () => {
    const b = parseDraft(r.md);
    const all = b.map((x) => x.t === "section" && x.text);
    const roles = b.slice(all.indexOf("Experience"), all.indexOf("Selected Projects")).filter((x) => x.t === "role");
    expect(roles.filter((x) => /freelance/i.test(x.text))).toEqual([{ t: "role", text: "Freelance", right: "01/2015 – 05/2016" }]);
    const i = b.findIndex((x) => x.t === "role" && x.text === "Freelance");
    expect(b.slice(i + 1).filter((x) => x.t === "subrole").map((x) => x.text)).toEqual(["Developer, Computer Lunch", "Web Developer, Weather Company"]);
  });

  it("moves side work that overlaps a job to Selected Projects", () => {
    const b = parseDraft(r.md);
    const sections = b.flatMap((x, i) => (x.t === "section" ? [[x.text, i] as const] : []));
    expect(sections.map((s) => s[0])).toEqual(["Summary", "Experience", "Selected Projects", "Education"]);
    const proj = sections.find((s) => s[0] === "Selected Projects")![1];
    expect(b[proj + 1]).toEqual({ t: "role", text: "Freelance Brand Designer, Studio Nine | New York, NY", right: "03/2024 – 09/2024" });
    expect(r.fixed.join(" ")).toContain("Selected Projects");
  });

  it("keeps every bullet", () => {
    for (const l of messy.split("\n").filter((l) => l.startsWith("- "))) expect(r.md).toContain(l);
  });

  it("leaves a resume that already follows the rules untouched", () => {
    expect(shapeResume(r.md)).toEqual({ md: r.md, fixed: [] });
  });

  it("doesn't group or move jobs that don't overlap and have different employers", () => {
    const plain = "# A\n\n## Experience\n### Lead, Acme | 2020 – Present\n- x\n### Dev, Beta | 2015 – 2019\n- y";
    expect(shapeResume(plain).fixed).toEqual([]);
  });

  it("keeps a current job in Experience when an older job also runs to Present (#916)", () => {
    const md = "# A\n\n## Experience\n### Senior Engineer, BigCo | 03/2021 – Present\n- x\n### Founder, Doe Studio | 2015 – Present\n- y";
    const r = shapeResume(md);
    expect(r.md).not.toContain("Selected Projects");
    expect(r.md).toContain("### Senior Engineer, BigCo | 03/2021 – Present");
    expect(r.fixed.join(" ")).not.toContain("Selected Projects");
  });

  it("keeps two stints at one employer apart when another job sits between them (#896)", () => {
    const md = `# A

## Experience
### Staff Engineer, Acme | 03/2019 – Present
- Leads platform.
### Senior Engineer, Globex | 06/2015 – 02/2019
- Built billing.
### Engineer, Acme | 01/2012 – 05/2015
- Shipped search.`;
    const out = shapeResume(md);
    const b = parseDraft(out.md);
    expect(b.filter((x) => x.t === "section").map((x) => x.text)).toEqual(["Experience"]);
    expect(b.filter((x) => x.t === "role").map((x) => [x.text, x.right])).toEqual([
      ["Staff Engineer, Acme", "03/2019 – Present"],
      ["Senior Engineer, Globex", "06/2015 – 02/2019"],
      ["Engineer, Acme", "01/2012 – 05/2015"],
    ]);
    expect(out.fixed).toEqual([]);
    // Back to back at one employer, with nothing between, still merges.
    const promo = md.replace(/### Senior Engineer, Globex[^\n]*\n- Built billing.\n/, "").replace("01/2012 – 05/2015", "01/2012 – 02/2019");
    expect(parseDraft(shapeResume(promo).md).filter((x) => x.t === "role").map((x) => x.text)).toEqual(["Acme"]);
  });

  it("reads right in the rendered file, not just the data", async () => {
    const p = await rendered(r.md, "4338CA");
    const text = p.map((x) => x.text);
    expect(text.filter((t) => /^RPM\b/.test(t))).toEqual(["RPM | New York, NY\t06/2016 – 05/2021"]);
    expect(text.filter((t) => /RPM/.test(t))).toHaveLength(1);
    const experience = text.slice(text.indexOf("Experience"), text.indexOf("Selected Projects"));
    expect(experience.filter((t) => /^Freelance\b/.test(t))).toEqual(["Freelance\t01/2015 – 05/2016"]);
    const at = (t: string) => text.indexOf(t);
    expect(at("Senior Developer\t01/2019 – 05/2021")).toBeGreaterThan(at("RPM | New York, NY\t06/2016 – 05/2021"));
    expect(at("Developer\t01/2017 – 12/2018")).toBeGreaterThan(at("Senior Developer\t01/2019 – 05/2021"));
    expect(at("Junior Developer\t06/2016 – 12/2016")).toBeGreaterThan(at("Developer\t01/2017 – 12/2018"));
    expect(text).toContain("UX Engineering Lead (contract via Photon)\t06/2021 – 12/2024");
    expect(at("Freelance Brand Designer, Studio Nine | New York, NY\t03/2024 – 09/2024")).toBeGreaterThan(at("Selected Projects"));
    expect(at("Selected Projects")).toBeGreaterThan(at("Experience"));
    expect(at("Freelance Brand Designer, Studio Nine | New York, NY\t03/2024 – 09/2024")).toBeGreaterThan(at("Junior Developer\t06/2016 – 12/2016"));
    // Titles under an employer carry the chosen highlight; the employer heading stays plain ink.
    expect(p.find((x) => x.text.startsWith("Vice President"))?.color).toBe("4338CA");
    expect(p.find((x) => x.text.startsWith("Citi |"))?.color).toBe("161616");
  });

  it("uses the Cool default when no highlight was picked", async () => {
    const p = await rendered(r.md);
    expect(p.find((x) => x.text.startsWith("Vice President"))?.color).toBe("C2410C");
  });
});
