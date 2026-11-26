import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));
import { answersBox, checksBox, pickOne, pickOptions } from "@/lib/application/fillPlan";
import { dateAnswer, numberAnswer } from "@/lib/application/submit";

/**
 * fill.js can't import from src, so it carries its own copies of the worker's answer rules (#1541). Each copy is pulled
 * out of the file by name and run over the same hard answers as the worker's: a fix made in one copy only fails here.
 */
const SOURCE = readFileSync(path.resolve(__dirname, "../../../extension/firefox/fill.js"), "utf8");

/** The text of `function name(...) {...}` or a one-line `const name = ...;` in fill.js. */
function grab(name: string): string {
  const fn = SOURCE.indexOf(`function ${name}(`);
  if (fn >= 0) {
    const open = SOURCE.indexOf("{", SOURCE.indexOf(")", fn));
    let depth = 0;
    for (let i = open; i < SOURCE.length; i++) {
      if (SOURCE[i] === "{") depth++;
      else if (SOURCE[i] === "}" && --depth === 0) return SOURCE.slice(fn, i + 1);
    }
  }
  const line = SOURCE.match(new RegExp(`^\\s*const ${name} = .*;$`, "m"))?.[0];
  if (!line) throw new Error(`no ${name} in fill.js`);
  return line.trim();
}

type Rules = {
  numberAnswer: (t: string) => string;
  dateAnswer: (t: string) => string;
  pickOne: (a: string, labels: string[]) => number;
  pickOptions: (c: string, o: string[]) => string[];
  checksBox: (a: string) => boolean;
  answersBox: (a: string) => boolean;
};
const NAMES = ["norm", "startsWord", "compact", "sameText", "pickOptions", "checksBox", "answersBox", "pickOne", "numberAnswer", "dateAnswer"];
const ext = new Function(`${NAMES.map(grab).join("\n")}\nreturn { numberAnswer, dateAnswer, pickOne, pickOptions, checksBox, answersBox };`)() as Rules;

describe("fill.js answer rules match the worker's (#1541)", () => {
  it("reads the same number", () => {
    for (const t of ["$165,000", "$165k", "165K", "$120-150k", "120 - 150k", "100 to 120k", "$1.5M", "1.2m", "$95.50", "12", "5+ years", "Over a decade", "", "$1,200,000", "150k-180k", "about 2,000 hours", "$120 K", "$120 K - $150 K", "165 thousand", "1.2 million", "5 m", "5 months", "2 Months", "120 TO 150K", "€90.000", "90.000,00 €", "1.250.000", "$2.300K", "150 000 €", "CHF 150'000", "1\u00a0250\u00a0000", "150 000,00 €", "12 3456", "CHF 150’000", "1’250’000", "€ 90.000,-", "90.000,-- EUR", "150 000,- €", "it’s 5 years"])
      expect(ext.numberAnswer(t), t).toBe(numberAnswer(t));
  });

  it("reads the same date", () => {
    for (const t of [
      "January 2027",
      "Jan. 2027",
      "01/2027",
      "2027-01",
      "market 2026",
      "12/01/2026",
      "12-01-2026",
      "2026-12-01",
      "2026/12/1",
      "12/15/26",
      "December 1, 2026",
      "1-Dec-2026",
      "1st of December 2026",
      "2026.12.01",
      "01.12.2026",
      "31.02.2026",
      "Dec. 1st, 2026",
      "Sept 3 2026",
      "1 Dec 2026",
      "3rd March, 2027",
      "2026-02-30",
      "02/29/2028",
      "02/29/2027",
      "13/01/2026",
      "Two weeks after an offer",
      "ASAP",
      "",
    ])
      expect(ext.dateAnswer(t), t).toBe(dateAnswer(t));
  });

  it("picks the same dropdown option", () => {
    const lists = [
      ["Yes", "No", "None of the above"],
      ["Full-time", "Part-time", "Contract"],
      ["On-site", "Hybrid", "Remote"],
      ["Yes – I am authorized", "No – I am not authorized"],
      ["I don’t wish to answer", "Woman", "Man"],
      ["Yes*", "No*"],
      ["", "Select…", "Bachelor's", "Master's"],
      ["LinkedIn", "Company website", "Referral from an employee"],
      ["Less than 1 year", "1-2 years", "3-5 years", "6-10 years", "10+ years"],
      ["0-1", "1-2", "1.5", "12+"],
    ];
    const answers = ["No", "None", "Yes", "Full time", "Onsite", "Yes - I am authorized", "Yes—I am authorized", "I don't wish to answer", "yes", "Bachelors", "Masters", "Referral", "LinkedIn profile", "Something else", "12 years", "12", "15", "1 - 2 years", "3–5 years", ""];
    for (const labels of lists) for (const a of answers) expect(ext.pickOne(a, labels), `${a} in ${labels.join("|")}`).toBe(pickOne(a, labels));
  });

  it("ticks the same boxes on a select-all question", () => {
    const options = ["Figma", "Sketch", "Adobe Creative Suite", "Full-time", "No", "None of the above"];
    for (const c of ["Figma\nAdobe", "None", "No", "Full time\nSketch", "figma\nFIGMA", "Nothing here", "", "Adobe Creative Suite (Photoshop, Illustrator)"])
      expect(ext.pickOptions(c, options), c).toEqual(pickOptions(c, options));
    expect(ext.pickOptions("Free text\nSecond line", [])).toEqual(pickOptions("Free text\nSecond line", []));
  });

  it("reads a checkbox answer the same way", () => {
    for (const a of [
      "Yes",
      "yes, I agree",
      "I agree*",
      "Agreed",
      "I acknowledge",
      "I have read and agree",
      "I’ve read and understood",
      "Read and agreed",
      "I hereby certify",
      "I authorise",
      "Understood",
      "No",
      "false",
      "I do not agree",
      "",
      "https://linkedin.com/in/pat",
      "  YES  ",
    ]) {
      expect(ext.checksBox(a), a).toBe(checksBox(a));
      expect(ext.answersBox(a), a).toBe(answersBox(a));
    }
  });
});
