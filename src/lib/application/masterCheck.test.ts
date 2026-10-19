import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { finishMaster, masterForDrafts, roleSwaps, unplacedLines } from "./masterCheck";
import { parseDraft } from "./resumeLayout";

// The Oct 18 layout: a two-column PDF where each job's bullets come out BEFORE its title line.
const source = readFileSync(new URL("../../../test/fixtures/oct18-two-column.txt", import.meta.url), "utf8");

/** Each bullet, keyed by the role heading it sits under. */
function byRole(md: string) {
  const out: Record<string, string[]> = {};
  let role = "";
  for (const b of parseDraft(md)) {
    if (b.t === "role" || b.t === "subrole" || b.t === "section") role = b.text;
    else if (b.t === "bullet") (out[role] ??= []).push(b.text);
  }
  return out;
}

// What reading that text in order gives: every job's first line lands under the job above it.
const misread = `# Eric Devlin
VP, UX Engineering
New York, NY • eric@example.com • linkedin.com/in/example
## Summary
UX engineering leader who builds design systems and the teams that ship them.
## Experience
### Vice President, UX Engineering, Citi | New York, NY | 07/2021 – Present
- Design System: Led the firm-wide design system used by over 40 product teams, with accessible components in React and Angular.
- Accessibility: Set the WCAG 2.1 AA bar for consumer web and trained engineers across three regions.
- Delivery: Cut release time for new UI from weeks to days with a shared component pipeline.
- Team Expansion: Grew the web development team from two to nine developers and set up code review and hiring.
### Web Development Team Lead, RPM | New York, NY | 07/2017 – 07/2021
- Client Work: Built over 35 websites for consumer brands, from pitch to launch.
- Process: Introduced sprint planning and estimates that held across a year of client work.
### Freelance Web Developer | New York, NY | 03/2016 – 11/2017
- Built marketing sites for small businesses on WordPress and custom stacks.
- Prototyped browser games for an indie studio.
## Skills
React, TypeScript, Design systems, Accessibility, Team leadership`;

describe("finishMaster on the Oct 18 two-column layout", () => {
  it("never leaves the RPM Team Expansion bullet under Citi", () => {
    const r = byRole(finishMaster(misread, source).md);
    const citi = Object.keys(r).find((k) => k.includes("Citi"))!;
    const rpm = Object.keys(r).find((k) => k.includes("RPM"))!;
    expect(r[citi].some((b) => b.startsWith("Team Expansion"))).toBe(false);
    expect(r[rpm].some((b) => b.startsWith("Team Expansion"))).toBe(true);
    expect(r[rpm]).toHaveLength(3);
    expect(r[citi]).toHaveLength(3);
  });
});

describe("finishMaster checks", () => {
  it("says what it moved", () => {
    const r = finishMaster(misread, source);
    expect(r.uncertain.join("\n")).toMatch(/moved "Team Expansion.*under Web Development Team Lead, RPM.*not Vice President, UX Engineering, Citi/);
  });

  it("puts a line the rebuild dropped under Unplaced, flagged", () => {
    const fixed = finishMaster(misread, source).md;
    const dropped = fixed.replace("- Prototyped browser games for an indie studio.\n", "");
    const r = finishMaster(dropped, source);
    expect(unplacedLines(r.md)).toEqual(["Prototyped browser games for an indie studio."]);
    expect(r.uncertain.join("\n")).toMatch(/One line from your file didn't make it into the rebuild/);
  });

  it("leaves a correct rebuild alone", () => {
    const right = finishMaster(misread, source).md;
    const again = finishMaster(right, source);
    expect(again.md).toBe(right);
    expect(again.uncertain).toEqual([]);
  });

  it("reads normal order too: heading first, bullets after", () => {
    const src = "Lead, Acme New York, NY • 2020 - 2024\n• Shipped the checkout redesign to every market\n• Ran the weekly design review for the whole org\nDesigner, Beta Corp New York, NY • 2016 - 2020\n• Built the first component library at Beta\n• Hired and trained four junior designers";
    const md = "## Experience\n### Lead, Acme | 2020 – 2024\n- Shipped the checkout redesign to every market\n- Ran the weekly design review for the whole org\n- Built the first component library at Beta\n### Designer, Beta Corp | 2016 – 2020\n- Hired and trained four junior designers";
    const r = byRole(finishMaster(md, src).md);
    expect(r["Designer, Beta Corp"]).toContain("Built the first component library at Beta");
    expect(r["Lead, Acme"]).toHaveLength(2);
  });
});

describe("unplacedLines", () => {
  it("reads only the Unplaced section", () => {
    expect(unplacedLines("## Experience\n- a b c\n## Unplaced\n- Stray line here\n- Another one")).toEqual(["Stray line here", "Another one"]);
    expect(unplacedLines("## Experience\n- a")).toEqual([]);
  });
});

describe("drafting from the confirmed master", () => {
  const m = { md: "rebuild", fromHash: "h2", edited: false, at: "2026-10-19", uncertain: [] };
  it("reads the confirmed version, not a newer rebuild", () => {
    expect(masterForDrafts({ ...m, confirmed: { md: "confirmed", at: "2026-10-18" } })).toBe("confirmed");
    expect(masterForDrafts(m)).toBe("rebuild");
    expect(masterForDrafts({ ...m, edited: true, md: "fixed by hand" })).toBe("fixed by hand");
    expect(masterForDrafts(null)).toBeNull();
    expect(masterForDrafts({ ...m, md: "## Experience\n- a\n\n## Unplaced\n- stray\n## Skills\nReact" })).toBe("## Experience\n- a\n## Skills\nReact");
    expect(masterForDrafts({ ...m, md: "## Experience\n- a\n\n## Unplaced\n- stray" })).toBe("## Experience\n- a");
  });

  it("flags a draft bullet that moved to another job", () => {
    const master = finishMaster(misread, source).md;
    const draft = "## Experience\n### Vice President, UX Engineering, Citi | 07/2021 – Present\n- Grew the web development team from two to nine developers, with code review and hiring\n- Led the firm-wide design system used by over 40 product teams\n### Web Development Team Lead, RPM | 07/2017 – 07/2021\n- Built over 35 websites for consumer brands, from pitch to launch";
    const s = roleSwaps(master, draft);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(/^"Grew the web development team.*under Vice President, UX Engineering, Citi here, but under Web Development Team Lead, RPM/);
    expect(roleSwaps(master, master)).toEqual([]);
  });
});
