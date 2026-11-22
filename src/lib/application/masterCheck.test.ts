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

  // #1638: two headings that share a word ("product", the employer) are still two jobs.
  const twoJobs =
    "## Experience\n### Senior Product Designer, Acme | 2022 – Present\n- Led the checkout redesign that lifted conversion by twelve percent\n- Ran weekly design critiques for the payments squad\n### Product Designer, Globex | 2018 – 2022\n- Built the mobile onboarding flow used by two million members\n- Set up usability testing with field researchers";
  it("flags a bullet moved between jobs whose titles share a word", () => {
    const draft =
      "## Experience\n### Senior Product Designer, Acme | 2022 – Present\n- Led the checkout redesign that lifted conversion by twelve percent\n- Built the mobile onboarding flow used by two million members\n### Product Designer, Globex | 2018 – 2022\n- Set up usability testing with field researchers";
    const s = roleSwaps(twoJobs, draft);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(/^"Built the mobile onboarding flow.*under Senior Product Designer, Acme here, but under Product Designer, Globex/);
    expect(roleSwaps(twoJobs, twoJobs)).toEqual([]);
  });

  it("flags a bullet moved between titles at the same employer", () => {
    const grouped =
      "## Experience\n### Acme\n#### Design Manager | 2023 – Present\n- Hired and coached a team of six designers\n- Set the design roadmap with product leads\n#### Product Designer | 2019 – 2023\n- Shipped the new search results page for the web app\n- Ran diary studies with small business owners";
    const draft =
      "## Experience\n### Acme\n#### Design Manager | 2023 – Present\n- Hired and coached a team of six designers\n- Shipped the new search results page for the web app\n#### Product Designer | 2019 – 2023\n- Ran diary studies with small business owners";
    const s = roleSwaps(grouped, draft);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(/^"Shipped the new search results page.*under Design Manager, Acme here, but under Product Designer, Acme/);
    expect(roleSwaps(grouped, grouped)).toEqual([]);
  });

  it("pairs a reworded heading with the job its bullets come from", () => {
    const promoted =
      "## Experience\n### Senior Product Designer, Acme | 2022 – Present\n- Led the checkout redesign that lifted conversion by twelve percent\n- Ran weekly design critiques for the payments squad\n### Product Designer, Acme | 2019 – 2022\n- Built the mobile onboarding flow used by two million members";
    // "Lead Product Designer" shares more words with "Product Designer, Acme", but its bullets are the senior job's.
    const draft =
      "## Experience\n### Lead Product Designer, Acme Inc | 2022 – Present\n- Led the checkout redesign that lifted conversion by twelve percent\n- Ran weekly design critiques for the payments squad team\n### Product Designer, Acme | 2019 – 2022\n- Built the mobile onboarding flow used by two million members";
    expect(roleSwaps(promoted, draft)).toEqual([]);
  });
});
