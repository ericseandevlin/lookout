import { describe, expect, it } from "vitest";
import { keepRfps, naicsCodes, rfpText, samDate, samQueries, setAsideCodes, toRfpItem } from "./samGov";

const rec = (over: Record<string, unknown> = {}) => ({
  noticeId: "abc123",
  title: "Event Production Services ",
  fullParentPathName: "GENERAL SERVICES ADMINISTRATION.PUBLIC BUILDINGS SERVICE.PBS R2",
  postedDate: "2026-11-01",
  type: "Combined Synopsis/Solicitation",
  typeOfSetAside: "WOSB",
  typeOfSetAsideDescription: "Women-Owned Small Business (WOSB) Program Set-Aside (FAR 19.15)",
  responseDeadLine: "2026-11-20T17:00:00-05:00",
  naicsCode: "561920",
  active: "Yes",
  award: null,
  placeOfPerformance: { city: { name: "New York" }, state: { code: "NY" } },
  uiLink: "https://sam.gov/opp/abc123/view",
  ...over,
});

describe("query building (#272)", () => {
  it("pulls six-digit NAICS codes, three at most", () => {
    expect(naicsCodes("561920, 711310; 561910 and 541611")).toEqual(["561920", "711310", "561910"]);
    expect(naicsCodes("event production")).toEqual([]);
  });
  it("maps certifications to set-aside codes", () => {
    expect(setAsideCodes(["8(a)", "WOSB", "Small business"])).toEqual(["8A", "WOSB", "SBA"]);
    expect(setAsideCodes("SDVOSB and HUBZone")).toEqual(["SDVOSBC", "HZC"]);
    expect(setAsideCodes("")).toEqual([]);
  });
  it("asks for the last 30 days, one call per code", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(samDate(now)).toBe("11/07/2026");
    const q = samQueries({ naics: "561920, 711310" }, now);
    expect(q.map((p) => p.get("ncode"))).toEqual(["561920", "711310"]);
    expect(q[0].get("postedFrom")).toBe("10/08/2026");
    expect(q[0].get("ptype")).toBe("o,k,p");
    expect(samQueries({}, now)).toHaveLength(1);
    expect(samQueries({}, now)[0].has("ncode")).toBe(false);
  });
});

describe("mapping and filtering", () => {
  it("maps a record to a board item", () => {
    expect(toRfpItem(rec())).toMatchObject({ noticeId: "abc123", title: "Event Production Services", agency: "Public Buildings Service", due: "2026-11-20", place: "New York, NY", value: null, naics: "561920" });
    expect(toRfpItem(rec({ award: { amount: "250000.00" } }))?.value).toBe(250000);
    expect(toRfpItem(rec({ uiLink: "javascript:alert(1)" }))?.url).toBe("https://sam.gov/opp/abc123/view");
    expect(toRfpItem({ title: "no id" })).toBeNull();
  });
  it("keeps open notices the business can bid on", () => {
    const opts = { today: "2026-11-07", known: new Set<string>(), setAsides: ["WOSB"] };
    const list = [
      rec(),
      rec({ noticeId: "past", responseDeadLine: "2026-11-01" }),
      rec({ noticeId: "8a", typeOfSetAside: "8A" }),
      rec({ noticeId: "open", typeOfSetAside: null, typeOfSetAsideDescription: null }),
      rec({ noticeId: "inactive", active: "No" }),
      rec(),
    ];
    expect(keepRfps(list, opts).map((i) => i.noticeId)).toEqual(["abc123", "open"]);
    expect(keepRfps(list, { ...opts, known: new Set(["abc123"]) }).map((i) => i.noticeId)).toEqual(["open"]);
  });
  it("writes the scorer's text from facts only", () => {
    const t = rfpText(toRfpItem(rec())!);
    expect(t).toContain("Set-aside: Women-Owned");
    expect(t).toContain("Value: (not posted)");
  });
});
