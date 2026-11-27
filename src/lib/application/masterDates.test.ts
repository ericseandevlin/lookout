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

  it.each([
    "Staff Engineer, Acme Corp  March 2019 – June 2021",
    "Staff Engineer, Acme Corp  Mar 2019 - Jun 2021",
    "Staff Engineer, Acme Corp  Mar. 2019 to Jun. 2021",
    "Staff Engineer, Acme Corp  3/2019 - 6/2021",
    "Staff Engineer, Acme Corp  2019 - 2021",
  ])("says nothing when the file wrote the same dates another way: %s (#907)", (line) => {
    expect(looseDates("### Staff Engineer | Acme Corp | 03/2019 – 06/2021", `Jane Doe\n${line}\n- Built billing.`)).toEqual([]);
  });

  it.each([
    "Staff Engineer, Acme Corp  Mar '19 - Jun '21",
    "Staff Engineer, Acme Corp  Mar’19 – Jun’21",
    "Staff Engineer, Acme Corp  March ’19 to June ’21",
    "Staff Engineer, Acme Corp  3/2019 - Jun '21",
  ])("reads a year written with an apostrophe as the full year: %s (#1730)", (line) => {
    expect(looseDates("### Staff Engineer | Acme Corp | 03/2019 – 06/2021", `Jane Doe\n${line}\n- Built billing.`)).toEqual([]);
  });

  it("reads '98 as 1998, and a bare two-digit number or the wrong short year as no match (#1730)", () => {
    expect(looseDates("### Analyst | Initech | 1998 – 2001", "Analyst, Initech  '98 - '01")).toEqual([]);
    expect(looseDates("### Staff Engineer | Acme Corp | 03/2019 – 06/2021", "Staff Engineer, Acme Corp  Mar 19 - Jun 21")).toHaveLength(1);
    expect(looseDates("### Staff Engineer | Acme Corp | 03/2019 – 06/2021", "Staff Engineer, Acme Corp  Mar '18 - Jun '21")).toHaveLength(1);
  });

  it("reads Present the same whatever the word (#907)", () => {
    expect(looseDates("### Staff Engineer | Acme Corp | 03/2019 – Present", "Staff Engineer, Acme Corp  March 2019 - Current")).toEqual([]);
  });

  it("still warns when the months differ or the dates sit on another line (#907)", () => {
    expect(looseDates("### Staff Engineer | Acme Corp | 03/2019 – 06/2021", "Staff Engineer, Acme Corp  April 2019 - June 2021")).toHaveLength(1);
    expect(looseDates("### Staff Engineer | Acme Corp | 03/2019 – 06/2021", "Staff Engineer, Acme Corp\nMarch 2019 - June 2021")).toHaveLength(1);
    expect(looseDates("### Staff Engineer | Acme Corp | 03/2019 – Present", "Staff Engineer, Acme Corp  March 2019 - June 2021")).toHaveLength(1);
  });

  it.each(["Director of Marketing 2019 – 2021", "Director of Marketing, Marriott 2019 – 2021", "Director of Marketing, Mayo Clinic 2019 – 2021", "Director of Marketing  Sept. 2019 – June 2021"])(
    "reads a word that only starts like a month as no month: %s (#1177)",
    (line) => {
      expect(looseDates("### Director of Marketing | Acme | 09/2019 – 06/2021", line)).toEqual([]);
    },
  );

  it("still reads the month when a word that starts like one sits before it (#1177)", () => {
    expect(looseDates("### Director of Marketing | Acme | 09/2019 – 06/2021", "Director of Marketing  March 2019 – June 2021")).toHaveLength(1);
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

  it("checks each title's dates under an employer with several titles, not the employer span (#1629)", () => {
    const src = "Senior Product Designer, Acme 03/2021 – Present\n- Led the checkout redesign.\nProduct Designer, Acme 06/2018 – 02/2021";
    const md = "### Acme | New York, NY | 06/2018 – Present\n#### Senior Product Designer | 03/2021 – Present\n#### Product Designer | 06/2018 – 02/2021";
    expect(looseDates(md, src)).toEqual([]);
    const out = looseDates("### Acme | New York\n#### Product Designer | 06/2018 – 02/2021", "Acme\nProduct Designer\n06/2018 – 02/2021\n- Built the design system.");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"Product Designer"');
    // A one-title employer heading is still checked.
    expect(looseDates("### Acme | New York | 06/2018 – 02/2021\n- Built it.", "Acme\n06/2018 – 02/2021")).toHaveLength(1);
  });

  it("reads 'to date', 'till date', a dash then 'Date' and 'Ongoing' as the open end (#1844)", () => {
    const md = "### Designer | Acme | Mar 2019 - Present";
    for (const end of ["to date", "Till Date", "till now", "until present", "Date", "Ongoing", "Present"])
      expect(looseDates(md, `Designer, Acme  March 2019 – ${end}`), end).toEqual([]);
    // "Date" only counts after a dash: "Start date" before the years is no open end.
    expect(looseDates(md, "Designer, Acme start date March 2019")).toHaveLength(1);
  });

  it("reads a two-digit end year after a full one as that year (#1844)", () => {
    expect(looseDates("### Designer | Acme | 2019 - 2021", "Designer, Acme 2019-21")).toEqual([]);
    // Across a century it stays as written: "1998-02" could be February 1998.
    expect(looseDates("### Designer | Acme | 1998 - 2002", "Designer, Acme 1998 – 02")).toHaveLength(1);
    expect(looseDates("### Designer | Acme | 2019 - 2021", "Designer, Acme 2019 – 21")).toEqual([]);
    // ISO year and month stays a month: "2019-05" is not 2019 to 2005, and a full ISO date is left alone.
    expect(looseDates("### Designer | Acme | May 2019 - Present", "Designer, Acme 2019-05 - present")).toEqual([]);
    expect(looseDates("### Designer | Acme | 2019 - 2021", "Designer, Acme 2019-05-01")).toHaveLength(1);
  });
});
