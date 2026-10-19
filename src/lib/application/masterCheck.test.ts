import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { finishMaster } from "./masterCheck";
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
