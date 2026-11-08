import { describe, expect, it } from "vitest";
import { applyRules, fingerprint, normUrl } from "./rules";

const base = { score: 5, reasonsMatch: ["Director title"], reasonsGap: [], locationFit: true, dealbreaker: false, compMin: 140000, compMax: 160000 };

describe("applyRules", () => {
  it("keeps the model score when no rule fires", () => {
    expect(applyRules(base, 120000)?.score).toBe(5);
  });
  it("caps at 3 and explains when the range tops out below the floor", () => {
    const r = applyRules({ ...base, compMin: 90000, compMax: 95000 }, 120000)!;
    expect(r.score).toBe(3);
    expect(r.reasonsGap[0]).toMatch(/below your floor/);
  });
  it("does not penalize missing comp, only notes it", () => {
    const r = applyRules({ ...base, compMin: null, compMax: null }, 120000)!;
    expect(r.score).toBe(5);
    expect(r.reasonsGap).toContain("No comp posted");
  });
  it("caps at 3 outside preferred locations", () => {
    expect(applyRules({ ...base, locationFit: false }, null)!.score).toBe(3);
  });
  it("drops dealbreakers", () => {
    expect(applyRules({ ...base, dealbreaker: true }, null)).toBeNull();
  });
  it("never goes below 1 or above 5", () => {
    expect(applyRules({ ...base, score: 9 }, null)!.score).toBe(5);
    expect(applyRules({ ...base, score: 0 }, null)!.score).toBe(1);
  });
});

describe("dedupe keys", () => {
  it("fingerprints ignore case, punctuation and parentheticals", () => {
    expect(fingerprint("Tishman Speyer", "Director of Banquets", "Rockefeller Center, NY")).toBe(
      fingerprint("tishman speyer", "Director of Banquets (Rainbow Room)", "Rockefeller Center"),
    );
  });
  it("normalizes tracking params out of URLs", () => {
    expect(normUrl("https://www.boards.greenhouse.io/x/jobs/1?utm_source=li&gh_src=a")).toBe("boards.greenhouse.io/x/jobs/1");
    expect(normUrl("https://jobs.lever.co/x/1?lever-source=LinkedIn&lever-origin=applied&ref=hn&src=feed&source=x")).toBe("jobs.lever.co/x/1");
    expect(normUrl("https://example.com/job/1?refId=a1&trackingId=b2&trk=c3")).toBe("example.com/job/1");
  });
  it("keeps job IDs whose names start like a tracking param (#487)", () => {
    expect(normUrl("https://jobs.example.com/view?referenceId=111")).not.toBe(normUrl("https://jobs.example.com/view?referenceId=222"));
    expect(normUrl("https://x.icims.com/jobs/search?refnum=55&utm_medium=email")).toBe("x.icims.com/jobs/search?refnum=55");
    expect(normUrl("https://careers.x.com/job?sourceJobId=9")).toBe("careers.x.com/job?sourcejobid=9");
    expect(normUrl("https://boards.greenhouse.io/x?gh_jid=42&gh_src=a")).toBe("boards.greenhouse.io/x?gh_jid=42");
  });
});
