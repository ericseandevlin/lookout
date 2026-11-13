import { describe, expect, it } from "vitest";
import { BONUS_KEY, answeredCount, job, kindOf, kinds, parseMoney, rfp } from ".";

describe("job brief", () => {
  it("adds bonus context when given", () => {
    expect(job.brief({ q1: "Director", [BONUS_KEY]: " Open to Chicago later " })).toContain("Other context from them: Open to Chicago later");
  });

  it("leaves the brief unchanged without bonus context", () => {
    expect(job.brief({ q1: "Director", [BONUS_KEY]: "  " })).toBe(job.brief({ q1: "Director" }));
  });

  it("doesn't count bonus context as an answer", () => {
    expect(answeredCount(job, { [BONUS_KEY]: "x" })).toBe(0);
  });

  it("fills every line, with placeholders for what's missing", () => {
    expect(job.brief({})).toBe(
      [
        "Next role they want: (not given)",
        "Comp floor (base): (not given); would jump for: (not given)",
        "Work modes: (any); areas: (not given)",
        "Win they lead with: (not given)",
        "Dealbreakers: (none given)",
      ].join("\n"),
    );
  });

  it("joins work modes and ignores values of the wrong type", () => {
    const b = job.brief({ q1: ["not", "a string"], modes: ["Remote", "Hybrid"], area: " NYC " });
    expect(b).toContain("Next role they want: (not given)");
    expect(b).toContain("Work modes: Remote, Hybrid; areas: NYC");
  });
});

describe("rfp brief", () => {
  it("names each answer", () => {
    const b = rfp.brief({ q1: "Event production", naics: "561920", certs: "WOSB", floor: "$50k", target: "$2M", geo: "NYC" });
    expect(b).toContain("Work the business wants: Event production");
    expect(b).toContain("NAICS codes: 561920");
    expect(b).toContain("Certifications / set-asides: WOSB");
    expect(b).toContain("Contract value floor: $50k; would jump for: $2M");
    expect(b).toContain("Geographies they can serve: NYC");
  });
});

describe("kindOf", () => {
  it("returns the named kind", () => {
    expect(kindOf("rfp")).toBe(rfp);
  });

  it("falls back to jobs for null, undefined or an unknown id", () => {
    expect(kindOf(null)).toBe(job);
    expect(kindOf(undefined)).toBe(job);
    expect(kindOf("homes")).toBe(job);
  });
});

describe.each(Object.values(kinds))("$id config", (k) => {
  it("is registered under its own id", () => {
    expect(kinds[k.id]).toBe(k);
  });

  it("starts finds at a stage on its list", () => {
    expect(k.stages).toContain(k.defaultStage);
    expect(k.endedStages).not.toContain(k.defaultStage);
  });

  it("only ends finds at stages on its list", () => {
    for (const s of k.endedStages) expect(k.stages).toContain(s);
  });

  it("has unique question keys and three board columns", () => {
    const keys = k.questions.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(k.board.columns).toHaveLength(3);
  });
});

describe("answeredCount", () => {
  it("counts a comp question once either field is set", () => {
    expect(answeredCount(job, { floor: "$120k" })).toBe(1);
    expect(answeredCount(job, { target: "$160k" })).toBe(1);
    expect(answeredCount(job, { floor: "$120k", target: "$160k" })).toBe(1);
  });

  it("counts a work-mode question for a mode or an area", () => {
    expect(answeredCount(job, { modes: ["Remote"] })).toBe(1);
    expect(answeredCount(job, { area: "Brooklyn" })).toBe(1);
    expect(answeredCount(job, { modes: [], area: " " })).toBe(0);
  });

  it("ignores blank text answers", () => {
    expect(answeredCount(job, { q1: "  ", q4: "", q5: "No travel" })).toBe(1);
  });

  it("counts all five when everything is filled", () => {
    expect(answeredCount(job, { q1: "a", floor: "1", modes: ["Remote"], q4: "b", q5: "c" })).toBe(5);
    expect(answeredCount(rfp, { q1: "a", naics: "1", certs: "8(a)", target: "$1M", geo: "NYC" })).toBe(5);
  });
});

describe("parseMoney", () => {
  it.each([
    ["$120,000", 120000],
    ["120000", 120000],
    ["120k", 120000],
    ["$250K/yr", 250000],
    ["$2M", 2000000],
    ["1.5m", 1500000],
    ["2 million", 2000000],
    ["$1.2B", 1200000000],
    ["3bn", 3000000000],
    ["$95.5k", 95500],
    // A bare number under 1,000 is thousands (#761).
    ["150", 150000],
    ["$150", 150000],
    ["150-170k", 150000],
    ["150K+", 150000],
    ["999", 999000],
    ["1000", 1000],
    // Words around the number (#797).
    ["~$150k", 150000],
    ["USD 150,000", 150000],
    ["about 100k", 100000],
    ["min 150k", 150000],
    ["at least $140,000", 140000],
    ["150 base", 150000],
    ["150k base", 150000],
    ["$1.5MM", 1500000],
    ["2 mil", 2000000],
    ["1 200 000", 1200000],
    // A plural reads the whole number, not its first two digits (#882).
    ["low 200s", 200000],
    ["mid 150s", 150000],
    ["$180s", 180000],
    ["upper 190ks", 190000],
    ["120000 salary", 120000],
    // An hourly, weekly or monthly rate is annualized (#941).
    ["$85/hr", 176800],
    ["$85 an hour", 176800],
    ["85 per hour", 176800],
    ["$85 hourly", 176800],
    ["$85.50/h", 177840],
    ["$85-95/hr", 176800],
    // An en or em dash is a range too (#1081).
    ["$60–70/hr", 124800],
    ["$60 – $70/hr", 124800],
    ["$60—70 per hour", 124800],
    ["$9k–$10k/mo", 108000],
    ["$12,500/month", 150000],
    ["12.5k per month", 150000],
    ["$12,500 a month", 150000],
    ["$3,000/week", 156000],
    ["$250k/year", 250000],
    ["150k a year", 150000],
    ["150k base, hourly ok", 150000],
    // A day rate, biweekly and semimonthly pay (#982).
    ["$650/day", 169000],
    ["$650 a day", 169000],
    ["650 daily", 169000],
    ["$4,000 bi-weekly", 104000],
    ["$4,000 biweekly", 104000],
    ["$4000 every two weeks", 104000],
    ["$6,250 semi-monthly", 150000],
    ["$6,250 twice a month", 150000],
    ["$150,000 per year", 150000],
    ["150k/yr", 150000],
  ])("reads %s as %d", (v, n) => {
    expect(parseMoney(v)).toBe(n);
  });

  it.each([[""], ["  "], ["0"], ["€90k"], ["90k EUR"], ["£80,000"], ["negotiable"], ["6 figures"], ["low 6 figures"], [null], [120000], [["120k"]], ["$95 per project"], ["500/visit"]])("returns null for %j", (v) => {
    expect(parseMoney(v)).toBeNull();
  });
});
