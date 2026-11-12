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
  ])("reads %s as %d", (v, n) => {
    expect(parseMoney(v)).toBe(n);
  });

  it.each([[""], ["  "], ["0"], ["about 100k"], ["€90k"], [null], [120000], [["120k"]]])("returns null for %j", (v) => {
    expect(parseMoney(v)).toBeNull();
  });
});
