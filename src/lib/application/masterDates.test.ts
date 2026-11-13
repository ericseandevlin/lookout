import { describe, expect, it } from "vitest";
import { looseDates } from "./masterDates";

// A source file where each job's dates sit on its title line, the way a one-column PDF reads.
const source = `Jane Doe
Staff Engineer, Acme Corp 03/2019 – 06/2021
- Built the billing service.
Senior Developer at Globex 2015 - 2019
- Ran the mobile team.`;

describe("looseDates", () => {
  it("says nothing when the dates were on the title line (Title | Company | dates)", () => {
    expect(looseDates("### Staff Engineer | Acme Corp | 03/2019 – 06/2021", source)).toEqual([]);
  });

  it("says nothing when the dates were on the title line (Title | dates)", () => {
    expect(looseDates("### Senior Developer, Globex | 2015 - 2019", source)).toEqual([]);
  });

  it("warns once, naming the job, when the dates sat elsewhere in the file", () => {
    // Two-column PDF: dates float to their own line, away from the title.
    const loose = `Jane Doe
Staff Engineer, Acme Corp
03/2019 – 06/2021
- Built the billing service.`;
    const out = looseDates("### Staff Engineer | Acme Corp | 03/2019 – 06/2021", loose);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"Staff Engineer"');
    expect(out[0]).toContain("03/2019 – 06/2021");
  });

  it("warns when the dates are not in the file at all", () => {
    const out = looseDates("### Senior Developer | Globex | 2012 - 2014", source);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"Senior Developer"');
  });

  it("only warns for the jobs that were guessed", () => {
    const md = `## Experience
### Staff Engineer | Acme Corp | 03/2019 – 06/2021
- Built the billing service.
### Product Designer | Initech | 2011 - 2013
- Drew things.`;
    const out = looseDates(md, source);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"Product Designer"');
  });

  it.each([
    ["en dash", "–"],
    ["em dash", "—"],
    ["hyphen", "-"],
    ["spaced hyphen", " - "],
  ])("treats a %s in the rebuild the same as the source's dash", (_, dash) => {
    expect(looseDates(`### Staff Engineer | Acme Corp | 03/2019${dash}06/2021`, source)).toEqual([]);
    expect(looseDates(`### Senior Developer | Globex | 2015${dash}2019`, source)).toEqual([]);
  });

  it("treats a dash in the source the same whichever kind it is", () => {
    const md = "### Staff Engineer | Acme Corp | 2019 - 2021";
    for (const dash of ["–", "—", "-"]) {
      expect(looseDates(md, `Staff Engineer, Acme Corp 2019 ${dash} 2021`)).toEqual([]);
    }
  });

  it("says nothing for a short title whose dates were on its line (#858)", () => {
    expect(looseDates("### CTO | Acme Corp | 2019 - 2023", "CTO, Acme Corp 2019 – 2023")).toEqual([]);
    expect(looseDates("### VP, UX | 2016 - 2019", "VP, UX at Globex 2016 - 2019")).toEqual([]);
  });

  it("still warns for a short title whose dates sat elsewhere (#858)", () => {
    const out = looseDates("### CTO | Acme Corp | 2019 - 2023", "CTO\nAcme Corp\n2019 - 2023\nDevelopment work 2019 - 2023");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"CTO"');
    // A short word matches whole: "vp" is not in "development".
    expect(looseDates("### VP | 2019 - 2023", "Development 2019 - 2023")).toHaveLength(1);
  });

  it("ignores headings without a year", () => {
    expect(looseDates("### Staff Engineer | Acme Corp | Remote", source)).toEqual([]);
    expect(looseDates("### Side Projects | Present", source)).toEqual([]);
    expect(looseDates("### Staff Engineer", source)).toEqual([]);
  });

  it("ignores lines that are not job headings", () => {
    const md = `## Experience 2019 – 2021
- Shipped in 2020 | 2021
Staff Engineer | 2010 - 2011`;
    expect(looseDates(md, source)).toEqual([]);
  });
});
