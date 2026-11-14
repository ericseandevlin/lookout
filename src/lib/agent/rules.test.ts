import { describe, expect, it } from "vitest";
import { applyRules, fingerprint, legacyFingerprint, normUrl } from "./rules";

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
  it("still notes missing comp when a gap only mentions company or payments (#658)", () => {
    for (const g of ["Company is early stage", "Competitive market for this title", "Needs payments experience"]) {
      expect(applyRules({ ...base, compMin: null, compMax: null, reasonsGap: [g] }, null)!.reasonsGap).toContain("No comp posted");
    }
  });
  it("doesn't repeat missing comp when a gap already says it", () => {
    for (const g of ["Pay isn't listed", "No salary range given", "Comp not posted", "Compensation unknown"]) {
      expect(applyRules({ ...base, compMin: null, compMax: null, reasonsGap: [g] }, null)!.reasonsGap).toEqual([g]);
    }
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
  it("keeps the fingerprints of Latin-script postings stored before #1075", () => {
    expect(fingerprint("Tishman Speyer", "Director of Banquets", "Rockefeller Center, NY")).toBe("17ef17fd57dd4d6761d52d8fa79b4c4684a3352d");
    expect(legacyFingerprint("Café Société", "Sous-Chef (Nuit)", "Montréal, QC")).toBe("e82bc15d03229e2083e76c1f412fdc15adb57778");
    expect(legacyFingerprint("Tishman Speyer", "Director of Banquets", "Rockefeller Center, NY")).toBe("17ef17fd57dd4d6761d52d8fa79b4c4684a3352d");
  });
  it("keys an accented Latin name like its plain spelling (#1269)", () => {
    expect(fingerprint("Café Société", "Sous-Chef", "Montréal, QC")).toBe(fingerprint("Cafe Societe", "Sous-Chef", "Montreal"));
    expect(fingerprint("L'Oréal", "Designer", "Paris")).toBe(fingerprint("L'Oreal", "Designer", "Paris"));
    // One é character, or e plus a combining acute.
    expect(fingerprint("Acme", "Designer", "Montr\u00e9al")).toBe(fingerprint("Acme", "Designer", "Montre\u0301al"));
    expect(fingerprint("Ørsted", "Designer", "København")).toBe(fingerprint("Orsted", "Designer", "Kobenhavn"));
    expect(fingerprint("Acme", "Designer", "Düsseldorf")).toBe(fingerprint("Acme", "Designer", "Dusseldorf"));
    expect(fingerprint("Acme", "Designer", "Straße")).toBe(fingerprint("Acme", "Designer", "Strasse"));
    expect(fingerprint("Acme", "Designer", "Montréal")).not.toBe(legacyFingerprint("Acme", "Designer", "Montréal"));
    expect(fingerprint("Acme", "Designer", "Montreal")).toBe(legacyFingerprint("Acme", "Designer", "Montreal"));
  });
  it("keeps marks in non-Latin text, so डिज़ाइनर and डिजाइन stay apart (#1269)", () => {
    expect(fingerprint("मेरा", "डिज़ाइनर", "दिल्ली")).toBe(legacyFingerprint("मेरा", "डिज़ाइनर", "दिल्ली"));
    expect(fingerprint("メルカリ", "ガイド", "東京")).not.toBe(fingerprint("メルカリ", "カイト", "東京"));
  });
  it("tells apart postings whose company and title are in a non-Latin script (#1075)", () => {
    expect(fingerprint("メルカリ", "シニアエンジニア", "東京")).not.toBe(fingerprint("ソニー", "デザイナー", "東京"));
    expect(fingerprint("Яндекс", "Дизайнер", "Москва")).not.toBe(fingerprint("Сбер", "Аналитик", "Москва"));
    expect(fingerprint("Acme", "Senior エンジニア", "Tokyo")).not.toBe(fingerprint("Acme", "Senior デザイナー", "Tokyo"));
    expect(fingerprint("मेरा", "डिज़ाइनर", "दिल्ली")).not.toBe(fingerprint("मेरा", "डिजाइन", "दिल्ली"));
  });
  it("still ignores width, punctuation and parentheticals in non-Latin text", () => {
    expect(fingerprint("メルカリ", "シニア・エンジニア (正社員)", "東京, 日本")).toBe(fingerprint("メルカリ", "シニア エンジニア", "東京"));
    expect(fingerprint("ﾒﾙｶﾘ", "エンジニア", "東京")).toBe(fingerprint("メルカリ", "エンジニア", "東京"));
  });
  it("normalizes tracking params out of URLs", () => {
    expect(normUrl("https://www.boards.greenhouse.io/x/jobs/1?utm_source=li&gh_src=a")).toBe("boards.greenhouse.io/x/jobs/1");
    expect(normUrl("https://jobs.lever.co/x/1?lever-source=LinkedIn&lever-origin=applied&ref=hn&src=feed&source=x")).toBe("jobs.lever.co/x/1");
    expect(normUrl("https://example.com/job/1?refId=a1&trackingId=b2&trk=c3")).toBe("example.com/job/1");
  });
  it("drops ad and email click IDs, so a known job found through an ad stays known (#1193)", () => {
    expect(normUrl("https://jobs.lever.co/acme/abc?fbclid=xyz")).toBe("jobs.lever.co/acme/abc");
    // #1252
    expect(normUrl("https://jobs.jobvite.com/acme/job/oAbC1fwX?__jvst=Job%20Board&__jvsd=LinkedIn")).toBe(normUrl("https://jobs.jobvite.com/acme/job/oAbC1fwX"));
    expect(normUrl("https://boards.greenhouse.io/acme/jobs/123?gh_jid=123&gclid=abc")).toBe("boards.greenhouse.io/acme/jobs/123?gh_jid=123");
    expect(normUrl("https://acme.com/careers/1?msclkid=1&mc_cid=2&mc_eid=3&_hsenc=a&_hsmi=b&mkt_tok=c&li_fat_id=d&igshid=e&_gl=1*f&gbraid=g&wbraid=h&dclid=i")).toBe("acme.com/careers/1");
    expect(normUrl("https://acme.com/careers?jobId=9&GCLID=x")).toBe("acme.com/careers?jobid=9");
    // A job ID that only starts like a click ID stays.
    expect(normUrl("https://acme.com/careers?gclid_job=9")).toBe("acme.com/careers?gclid_job=9");
  });

  it("leaves the rest of the query as written when it drops a tracking tag (#1166)", () => {
    expect(normUrl("https://careers.example.com/job?title=Senior%20Designer&utm_source=linkedin")).toBe(normUrl("https://careers.example.com/job?title=Senior%20Designer"));
    expect(normUrl("https://careers.example.com/job?loc=NY,US&ref=x")).toBe(normUrl("https://careers.example.com/job?loc=NY,US"));
    expect(normUrl("https://careers.example.com/job?utm_source=a&id=7&path=a/b")).toBe("careers.example.com/job?id=7&path=a/b");
    expect(normUrl("https://careers.example.com/job?bad=%E9&utm_medium=x")).toBe("careers.example.com/job?bad=%e9");
  });
  it("keeps job IDs whose names start like a tracking param (#487)", () => {
    expect(normUrl("https://jobs.example.com/view?referenceId=111")).not.toBe(normUrl("https://jobs.example.com/view?referenceId=222"));
    expect(normUrl("https://x.icims.com/jobs/search?refnum=55&utm_medium=email")).toBe("x.icims.com/jobs/search?refnum=55");
    expect(normUrl("https://careers.x.com/job?sourceJobId=9")).toBe("careers.x.com/job?sourcejobid=9");
    expect(normUrl("https://boards.greenhouse.io/x?gh_jid=42&gh_src=a")).toBe("boards.greenhouse.io/x?gh_jid=42");
  });
  it("keeps a hash route, so jobs on a #/ routed careers page stay apart (#841)", () => {
    expect(normUrl("https://careers.acme.com/#/jobs/101")).not.toBe(normUrl("https://careers.acme.com/#/jobs/202"));
    expect(normUrl("https://careers.acme.com/?utm_source=li#!/Job/101/")).toBe("careers.acme.com#!/job/101");
    expect(normUrl("https://jobs.example.com/acme/123#content")).toBe("jobs.example.com/acme/123");
  });
});
