import { describe, expect, it } from "vitest";
import { applyRules, bareCompany, fingerprint, jobPageUrl, legacyFingerprint, listPage, noDashes, normUrl, placeId, placesDiffer, remoteFirst, suffixedFingerprint, unspelledCityFingerprint, unspelledFingerprint, usFormFingerprint } from "./rules";
import { jobKey } from "@/lib/extension/match";

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
  it("treats a lone starting pay under the floor as the top of the range (#877)", () => {
    const r = applyRules({ ...base, compMin: 150000, compMax: null }, 180000)!;
    expect(r.score).toBe(3);
    expect(r.reasonsGap[0]).toMatch(/below your floor/);
    expect(applyRules({ ...base, compMin: 190000, compMax: null }, 180000)!.score).toBe(5);
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
  it("keys a company without its legal form, so 'Acme, Inc.' and 'Acme' are one job (#1645)", () => {
    const k = (c: string) => fingerprint(c, "Senior Product Designer", "New York, NY");
    for (const c of ["Acme Inc.", "Acme, Inc.", "ACME INC", "Acme LLC", "Acme, L.L.C.", "Acme Ltd", "Acme Limited", "Acme Corp.", "Acme Corporation", "Acme Co.", "Acme GmbH", "Acme PLC", "Acme AG", "Acme S.A.", "Acme B.V.", "Acme Pty Ltd"]) expect(k(c)).toBe(k("Acme"));
    expect(bareCompany("Procter & Gamble Co.")).toBe("Procter & Gamble");
    // Not a legal form at the end, or nothing left without it.
    expect(bareCompany("Acme Co-op")).toBe("Acme Co-op");
    expect(bareCompany("Limited Brands")).toBe("Limited Brands");
    expect(bareCompany("Incorporated")).toBe("Incorporated");
    expect(bareCompany("Agco")).toBe("Agco");
    expect(k("Acme Labs")).not.toBe(k("Acme"));
    // The key from before #1645 keeps the legal form, and is the same as the new one for a bare name.
    expect(suffixedFingerprint("Acme, Inc.", "Designer", "Paris")).not.toBe(fingerprint("Acme, Inc.", "Designer", "Paris"));
    expect(suffixedFingerprint("Acme", "Designer", "Paris")).toBe(fingerprint("Acme", "Designer", "Paris"));
    expect(legacyFingerprint("Acme, Inc.", "Designer", "Paris")).toBe(suffixedFingerprint("Acme, Inc.", "Designer", "Paris"));
  });
  it("reads 'Sr.', 'Sr' and 'Snr' as senior and 'Jr.' as junior in the title (#1828)", () => {
    const k = (t: string) => fingerprint("Acme", t, "New York, NY");
    for (const t of ["Sr. Product Designer", "Sr Product Designer", "SR. PRODUCT DESIGNER", "Snr Product Designer", "Sr.Product Designer"]) expect(k(t), t).toBe(k("Senior Product Designer"));
    expect(k("Product Designer, Sr.")).toBe(k("Product Designer, Senior"));
    expect(k("Jr. Designer")).toBe(k("Junior Designer"));
    // Only a whole word: "Srinivasan" and "Jrnl" stay as they are, and senior stays apart from junior.
    expect(k("Srinivasan Designer")).not.toBe(k("Senior inivasan Designer"));
    expect(k("Sr. Designer")).not.toBe(k("Jr. Designer"));
    // The key from before #1828 keeps "sr", and is the same as the new one for a title without it.
    expect(unspelledFingerprint("Acme", "Sr. Product Designer", "New York, NY")).not.toBe(k("Sr. Product Designer"));
    expect(unspelledFingerprint("Acme, Inc.", "Product Designer", "New York, NY")).toBe(fingerprint("Acme, Inc.", "Product Designer", "New York, NY"));
    // The older keys are frozen: they never spell the rank out.
    expect(suffixedFingerprint("Acme", "Sr. Product Designer", "New York, NY")).toBe(unspelledFingerprint("Acme", "Sr. Product Designer", "New York, NY"));
  });
  it("keys a company without a legal form from outside the US too (#1831)", () => {
    const k = (c: string) => fingerprint(c, "Senior Product Designer", "New York, NY");
    for (const c of ["Acme Pvt Ltd", "Acme Pvt. Ltd.", "Acme Private Limited", "Acme Pte. Ltd.", "Acme & Co.", "Acme and Company", "Acme SE", "Acme N.V.", "Acme NV", "Acme AB", "Acme Oy", "Acme Oyj", "Acme A/S", "Acme SAS", "Acme S.A.S.", "Acme S.p.A.", "Acme S.r.l.", "Acme SRL", "Acme S.L.", "Acme Ltda", "Acme K.K.", "Acme Sdn Bhd", "Acme GmbH & Co. KG"]) expect(k(c), c).toBe(k("Acme"));
    expect(bareCompany("Acme & Co.")).toBe("Acme");
    expect(bareCompany("Procter & Gamble Co.")).toBe("Procter & Gamble");
    // A form that is also a word stays unless it has its dots, and "Private" stays without "Limited" after it.
    expect(bareCompany("Acme Spa")).toBe("Acme Spa");
    expect(bareCompany("Acme Private")).toBe("Acme Private");
    expect(bareCompany("Acme Bros")).toBe("Acme Bros");
    expect(bareCompany("Base")).toBe("Base");
    expect(k("Acme Labs AB")).not.toBe(k("Acme"));
    // The key from before #1831 keeps the newer forms, and is the same as the new one for a company with none of them.
    expect(usFormFingerprint("Acme Pvt Ltd", "Designer", "Paris")).not.toBe(fingerprint("Acme Pvt Ltd", "Designer", "Paris"));
    expect(usFormFingerprint("Acme, Inc.", "Sr. Designer", "Paris")).toBe(fingerprint("Acme, Inc.", "Sr. Designer", "Paris"));
    // The keys before it are frozen too.
    expect(unspelledFingerprint("Acme Pvt Ltd", "Designer", "Paris")).toBe(usFormFingerprint("Acme Pvt Ltd", "Designer", "Paris"));
    expect(unspelledFingerprint("Acme, Inc.", "Designer", "Paris")).toBe(fingerprint("Acme", "Designer", "Paris"));
  });
  it("keys one city written two common ways as one place (#1830)", () => {
    const k = (l: string) => fingerprint("Acme", "Senior Product Designer", l);
    for (const l of ["New York City, NY", "New York City", "NYC", "NYC, NY", "nyc"]) expect(k(l), l).toBe(k("New York, NY"));
    expect(k("St. Louis, MO")).toBe(k("Saint Louis, MO"));
    expect(k("St Paul, MN")).toBe(k("Saint Paul, MN"));
    expect(k("Ft. Lauderdale, FL")).toBe(k("Fort Lauderdale, FL"));
    expect(k("Mt. Vernon, NY")).toBe(k("Mount Vernon, NY"));
    expect(k("Washington D.C.")).toBe(k("Washington, DC"));
    expect(k("Washington DC")).toBe(k("Washington, DC"));
    // The short forms only as the city's first word, and other cities stay apart.
    expect(k("East St. Louis, IL")).not.toBe(k("East Saint Louis, IL"));
    expect(k("Stamford, CT")).toBe(unspelledCityFingerprint("Acme", "Senior Product Designer", "Stamford, CT"));
    expect(k("New York Mills, MN")).not.toBe(k("New York, NY"));
    expect(k("Washington Crossing, PA")).not.toBe(k("Washington, DC"));
    // The key from before #1830 keeps the city as written, and is the same as the new one for a city with no other spelling.
    expect(unspelledCityFingerprint("Acme", "Designer", "NYC")).not.toBe(fingerprint("Acme", "Designer", "NYC"));
    expect(unspelledCityFingerprint("Acme Pvt Ltd", "Sr. Designer", "Paris")).toBe(fingerprint("Acme Pvt Ltd", "Sr. Designer", "Paris"));
    // The keys before it are frozen too.
    for (const old of [usFormFingerprint, unspelledFingerprint, suffixedFingerprint, legacyFingerprint]) expect(old("Acme", "Designer", "NYC")).not.toBe(fingerprint("Acme", "Designer", "NYC"));
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
  it("drops Lever's array source tag, lever-source[], encoded or not (#1431)", () => {
    expect(normUrl("https://jobs.lever.co/acme/123?lever-source%5B%5D=LinkedIn")).toBe("jobs.lever.co/acme/123");
    expect(normUrl("https://jobs.lever.co/acme/123?lever-origin=applied&lever-source[]=Glassdoor")).toBe("jobs.lever.co/acme/123");
    // A job ID passed as an array stays in the key.
    expect(normUrl("https://acme.com/careers?jobId%5B%5D=9")).toBe("acme.com/careers?jobid%5b%5d=9");
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

  it("drops Google's srsltid, the _ga linker, more click IDs and Lever's lever-via (#1615)", () => {
    expect(normUrl("https://acme.com/careers/designer?srsltid=AfmBOoq123")).toBe("acme.com/careers/designer");
    expect(normUrl("https://acme.com/careers/1?_ga=2.1234.5678&gad_source=1&ttclid=a&twclid=b&yclid=c&rdt_cid=d&epik=e")).toBe("acme.com/careers/1");
    expect(normUrl("https://jobs.lever.co/acme/abc?lever-via=xyz")).toBe("jobs.lever.co/acme/abc");
    expect(normUrl("https://acme.com/careers?jobId=9&srsltid=x")).toBe("acme.com/careers?jobid=9");
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

describe("placesDiffer (#1285)", () => {
  it("reads a job listed at several places by its first (#1700)", () => {
    for (const b of ["New York, NY; San Francisco, CA", "New York, NY or San Francisco, CA", "New York, NY | Austin, TX", "New York, NY / Austin, TX"]) {
      expect(placesDiffer("New York, NY", b), b).toBe(false);
      expect(placeId(b), b).toBe("us-ny");
    }
    expect(placesDiffer("New York, NY (Hybrid)", "New York, NY (Hybrid); Chicago, IL")).toBe(false);
    // "OR" is a state, and "or Remote" names no second place.
    expect(placesDiffer("Portland, OR", "Portland, OR or Remote")).toBe(false);
    expect(placesDiffer("Portland, OR", "Portland, ME")).toBe(true);
  });

  it("reads a state or region outside the US and Canada as its country (#1702)", () => {
    for (const [a, b] of [
      ["Munich, Bavaria", "Munich, Germany"],
      ["Munich, Bavaria", "Munich, DE"],
      ["Stuttgart, Baden-Württemberg", "Stuttgart, Germany"],
      ["Sydney, NSW", "Sydney, Australia"],
      ["Sydney, New South Wales", "Sydney, NSW, Australia"],
      ["Bengaluru, Karnataka", "Bengaluru, India"],
      ["Barcelona, Catalonia", "Barcelona, Spain"],
      ["Amsterdam, North Holland", "Amsterdam, Netherlands"],
      ["Paris, Île-de-France", "Paris, FR"],
      ["São Paulo, São Paulo", "São Paulo, Brazil"],
    ]) expect(placesDiffer(a, b), `${a} | ${b}`).toBe(false);
    // Places in two countries still differ.
    expect(placesDiffer("Munich, Bavaria", "Munich, Austria")).toBe(true);
    expect(placesDiffer("Melbourne, Victoria", "Melbourne, FL")).toBe(true);
    expect(placesDiffer("Remote (Bavaria)", "Remote (US)")).toBe(true);
    expect(placeId("Sydney, NSW")).toBe("australia");
  });

  it("reads a state or country in parentheses (#1426)", () => {
    expect(placesDiffer("Remote (US)", "Remote (Canada)")).toBe(true);
    expect(placesDiffer("Remote (United States)", "Remote (Canada)")).toBe(true);
    expect(placesDiffer("Remote (US)", "Remote, Canada")).toBe(true);
    expect(placesDiffer("Portland (OR)", "Portland (ME)")).toBe(true);
    expect(placesDiffer("Remote (US)", "Remote, United States")).toBe(false);
    expect(placesDiffer("New York (NYC)", "New York, NY")).toBe(false);
    expect(placesDiffer("New York, NY (hybrid)", "New York, NY")).toBe(false);
    expect(placeId("Remote (Canada)")).toBe("ca");
  });

  it("reads an unknown country in parentheses after Remote (#1555)", () => {
    expect(placesDiffer("Remote (US)", "Remote (Germany)")).toBe(true);
    expect(placesDiffer("Remote (US)", "Remote (Mexico)")).toBe(true);
    expect(placesDiffer("Remote (India)", "Remote (Germany)")).toBe(true);
    expect(placesDiffer("Remote (Germany)", "Remote, Germany")).toBe(false);
    expect(placesDiffer("Remote (Germany)", "Remote (Germany)")).toBe(false);
    expect(placesDiffer("Remote (US)", "Remote (hybrid)")).toBe(false);
    expect(placesDiffer("Remote (US)", "Remote (Full-time)")).toBe(false);
    expect(placesDiffer("Remote (US)", "Remote (contract)")).toBe(false);
    expect(placesDiffer("New York (NYC)", "New York, NY")).toBe(false);
    expect(placesDiffer("New York, NY (Manhattan)", "New York, NY")).toBe(false);
  });

  it("reads a country's ISO code that is also a state's as that country (#1561)", () => {
    expect(placesDiffer("Berlin, DE", "Berlin, Germany")).toBe(false);
    expect(placesDiffer("Berlin, Germany", "Berlin, DE")).toBe(false);
    expect(placesDiffer("Munich, Bavaria, DE", "Munich, Germany")).toBe(false);
    expect(placesDiffer("Tel Aviv, IL", "Tel Aviv, Israel")).toBe(false);
    expect(placesDiffer("Bengaluru, IN", "Bengaluru, India")).toBe(false);
    expect(placesDiffer("Bogota, CO", "Bogota, Colombia")).toBe(false);
    expect(placesDiffer("Amsterdam, NL", "Amsterdam, Netherlands")).toBe(false);
    expect(placesDiffer("Amsterdam, NL", "Amsterdam, The Netherlands")).toBe(false);
    expect(placesDiffer("Remote (DE)", "Remote (Germany)")).toBe(false);
    // A real state pair, a named US state, or a code with its own country beside it still differs.
    expect(placesDiffer("Wilmington, DE", "Wilmington, NC")).toBe(true);
    expect(placesDiffer("Berlin, DE", "Berlin, NY")).toBe(true);
    expect(placesDiffer("Wilmington, DE, US", "Wilmington, Germany")).toBe(true);
    expect(placesDiffer("Wilmington, Delaware", "Wilmington, Germany")).toBe(true);
    expect(placesDiffer("Berlin, DE", "Berlin, India")).toBe(true);
    expect(placesDiffer("Bogota, CO", "Bogota, Mexico")).toBe(true);
  });

  it("reads any other country's two-letter code as that country (#1677)", () => {
    expect(placesDiffer("Paris, FR", "Paris, France")).toBe(false);
    expect(placesDiffer("Dublin, IE", "Dublin, Ireland")).toBe(false);
    expect(placesDiffer("Madrid, ES", "Madrid, Spain")).toBe(false);
    expect(placesDiffer("Sydney, NSW, AU", "Sydney, Australia")).toBe(false);
    expect(placesDiffer("Remote (FR)", "Remote (France)")).toBe(false);
    expect(placesDiffer("Remote, MX", "Remote, Mexico")).toBe(false);
    expect(placesDiffer("Prague, CZ", "Prague, Czechia")).toBe(false);
    expect(placesDiffer("Istanbul, TR", "Istanbul, Türkiye")).toBe(false);
    expect(placesDiffer("Abu Dhabi, AE", "Abu Dhabi, UAE")).toBe(false);
    // Two countries still differ, written either way.
    expect(placesDiffer("Paris, FR", "Paris, Texas")).toBe(true);
    expect(placesDiffer("Paris, FR", "Paris, TX")).toBe(true);
    expect(placesDiffer("London, GB", "London, ON")).toBe(true);
    expect(placesDiffer("Remote, FR", "Remote, ES")).toBe(true);
    expect(placeId("Paris, France")).toBe("france");
    expect(placeId("Paris, FR")).toBe("france");
  });

  it("reads a country's own name, a second name and a leading 'The' as one country (#1677)", () => {
    expect(placesDiffer("Amsterdam, The Netherlands", "Amsterdam, Netherlands")).toBe(false);
    expect(placesDiffer("Amsterdam, Holland", "Amsterdam, Netherlands")).toBe(false);
    expect(placesDiffer("Amsterdam, NL", "Amsterdam, Holland")).toBe(false);
    expect(placesDiffer("Berlin, Deutschland", "Berlin, Germany")).toBe(false);
    expect(placesDiffer("Madrid, España", "Madrid, Spain")).toBe(false);
    expect(placesDiffer("Vienna, Österreich", "Vienna, AT")).toBe(false);
    expect(placesDiffer("Zurich, Schweiz", "Zurich, Switzerland")).toBe(false);
    expect(placesDiffer("São Paulo, Brasil", "São Paulo, Brazil")).toBe(false);
    expect(placesDiffer("Manila, The Philippines", "Manila, PH")).toBe(false);
    expect(placesDiffer("Dublin, Éire", "Dublin, Republic of Ireland")).toBe(false);
    expect(placesDiffer("Shanghai, People's Republic of China", "Shanghai, CN")).toBe(false);
    expect(placesDiffer("Remote (Deutschland)", "Remote (Germany)")).toBe(false);
    // North Holland is the province, still the Netherlands; other countries still differ.
    expect(placesDiffer("Amsterdam, North Holland", "Amsterdam, Holland")).toBe(false);
    expect(placesDiffer("Berlin, Deutschland", "Berlin, NY")).toBe(true);
    expect(placesDiffer("Amsterdam, Holland", "Amsterdam, Germany")).toBe(true);
    expect(placeId("Amsterdam, The Netherlands")).toBe("netherlands");
  });

  it("tells apart the same city in another state or country", () => {
    expect(placesDiffer("Remote, US", "Remote, Canada")).toBe(true);
    expect(placesDiffer("Cambridge, MA", "Cambridge, United Kingdom")).toBe(true);
    expect(placesDiffer("Portland, OR", "Portland, ME")).toBe(true);
    expect(placesDiffer("Paris, TX", "Paris, France")).toBe(true);
    expect(placesDiffer("Remote, US", "Remote, Mexico")).toBe(true);
  });
  it("reads a known place inside filler words: 'Anywhere in the US' is the US (#1466)", () => {
    expect(placesDiffer("Remote, US", "Remote, Anywhere in the US")).toBe(false);
    expect(placesDiffer("Remote, United States", "Remote, Within the United States")).toBe(false);
    expect(placesDiffer("Remote, US", "Remote (anywhere in the US)")).toBe(false);
    expect(placesDiffer("Remote, Canada", "Remote, Anywhere in the US")).toBe(true);
    expect(placesDiffer("Remote, Canada", "Remote (anywhere in the US)")).toBe(true);
    expect(placeId("Remote, Anywhere in the US")).toBe("us");
    expect(placeId("Remote, across Canada")).toBe("ca");
    // "in" alone is still Indiana, and words that name no known place stay as they are.
    expect(placeId("Fort Wayne, IN")).toBe("us-in");
    expect(placeId("Remote, Anywhere in LATAM")).toBe("anywhere in latam");
  });
  it("keeps one place written two ways as one", () => {
    expect(placesDiffer("New York, NY", "New York, New York")).toBe(false);
    expect(placesDiffer("New York, NY (hybrid)", "New York, NY 10001, USA")).toBe(false);
    expect(placesDiffer("Remote, US", "Remote, United States of America")).toBe(false);
    expect(placesDiffer("Remote, U.S.", "Remote, USA")).toBe(false);
    expect(placesDiffer("Toronto, ON", "Toronto, Canada")).toBe(false);
    expect(placesDiffer("Toronto, Ontario, Canada", "Toronto, ON")).toBe(false);
    expect(placesDiffer("London, England", "London, UK")).toBe(false);
    expect(placesDiffer("San Francisco, CA", "San Francisco, California, United States")).toBe(false);
    expect(placesDiffer("Montréal, QC", "Montreal, Québec")).toBe(false);
  });
  it("reads dotted state codes like D.C. and N.Y. as the state (#1303)", () => {
    expect(placesDiffer("Washington, D.C.", "Washington, DC")).toBe(false);
    expect(placesDiffer("Washington, D.C., USA", "Washington, District of Columbia")).toBe(false);
    expect(placesDiffer("New York, N.Y.", "New York, NY")).toBe(false);
    expect(placeId("Washington, D.C.")).toBe("us-dc");
    expect(placesDiffer("Washington, D.C.", "Seattle, WA")).toBe(true);
  });
  it("does not split a location with no region from one with a region", () => {
    expect(placesDiffer("Remote", "Remote, Canada")).toBe(false);
    expect(placesDiffer("New York", "New York, NY")).toBe(false);
    expect(placesDiffer("", "Remote, US")).toBe(false);
  });
  it("names the region by state, else country", () => {
    expect(placeId("Portland, ME")).toBe("us-me");
    expect(placeId("Remote, Canada")).toBe("ca");
    expect(placeId("Paris, Île-de-France, France")).toBe("france");
  });
});

describe("placesDiffer: a work mode or 'metro area' after the place (#1374)", () => {
  it.each([
    ["New York, NY", "New York, NY - Hybrid"],
    ["New York, NY", "New York, NY or Remote"],
    ["Austin, TX", "Austin, TX · Hybrid"],
    ["Chicago, IL", "Chicago, IL Metro Area"],
    ["Remote, US", "Remote, US-based"],
    ["Remote, United States", "Remote, United States only"],
    ["Portland, OR", "Portland, OR - Hybrid"],
    ["Toronto, ON", "Toronto, ON - On site"],
  ])("%s and %s are one place", (a, b) => {
    expect(placesDiffer(a, b)).toBe(false);
  });

  it.each([
    ["Portland, OR", "Portland, ME - Hybrid"],
    ["Remote, US", "Remote, Canada only"],
  ])("%s and %s are still two places", (a, b) => {
    expect(placesDiffer(a, b)).toBe(true);
  });
});

describe("placesDiffer: a work mode after an unknown country, or on its own (#1385)", () => {
  it.each([
    ["Berlin, Germany", "Berlin, Germany - Hybrid"],
    ["Mexico City, Mexico", "Mexico City, Mexico or Remote"],
    ["New York, NY", "New York, Remote"],
  ])("%s and %s are one place", (a, b) => {
    expect(placesDiffer(a, b)).toBe(false);
  });

  it.each([
    ["Remote, Mexico", "Remote, Germany - Hybrid"],
    ["Berlin, Germany - Hybrid", "Berlin, Mexico"],
  ])("%s and %s are still two places", (a, b) => {
    expect(placesDiffer(a, b)).toBe(true);
  });
});

describe("placesDiffer: a coast or time zone after the place (#1510)", () => {
  it.each([
    ["Remote, US", "Remote, US - East Coast"],
    ["Remote, United States", "Remote, United States - Eastern Time"],
    ["Remote (US)", "Remote (US East Coast)"],
    ["Remote, USA", "Remote, USA (PST)"],
    ["Remote, Canada", "Remote, Canada - Pacific Time Zone"],
    ["Remote, US", "Remote, US Midwest"],
  ])("%s and %s are one place", (a, b) => {
    expect(placesDiffer(a, b)).toBe(false);
    expect(placeId(b)).toBe(placeId(a));
  });

  it.each([
    ["Remote, US - East Coast", "Remote, Canada"],
    ["Raleigh, North Carolina", "Raleigh, NY"],
    ["Charleston, West Virginia", "Charleston, SC"],
    ["Remote, Europe - Central Time", "Remote, US"],
  ])("%s and %s are still two places", (a, b) => {
    expect(placesDiffer(a, b)).toBe(true);
  });
});

describe("dedupe: remote and a country before the first comma (#1514)", () => {
  const fp = (loc: string) => fingerprint("Acme", "Product Designer", loc);

  it("keys every way of writing a remote US job as one find", () => {
    for (const loc of ["Remote - US", "US Remote", "USA (Remote)", "Remote – United States", "Remote U.S.", "Remote (US)", "US-based Remote"]) {
      expect(fp(loc), loc).toBe(fp("Remote, US"));
      expect(placesDiffer(loc, "Remote, US"), loc).toBe(false);
    }
    expect(fp("United States (Remote)")).toBe(fp("Remote, United States"));
  });

  it("keeps a remote job in another country apart", () => {
    expect(fp("Remote - Canada")).toBe(fp("Remote, US"));
    expect(placesDiffer("Remote - Canada", "Remote, US")).toBe(true);
    expect(placeId("Remote - Canada")).toBe("ca");
    expect(placesDiffer("UK Remote", "Remote (US)")).toBe(true);
  });

  it("leaves a city, a bare Remote and an unknown place as written", () => {
    expect(remoteFirst("New York (Remote)")).toBe("New York (Remote)");
    expect(remoteFirst("Remote")).toBe("Remote");
    expect(remoteFirst("Remote, US")).toBe("Remote, US");
    expect(remoteFirst("Remote - Mexico")).toBe("Remote - Mexico");
    expect(remoteFirst("United States")).toBe("United States");
    expect(remoteFirst("Remote - US, Eastern Time")).toBe("Remote, us, Eastern Time");
    expect(fp("New York (Remote)")).toBe(fp("New York, NY"));
  });

  it("keeps the legacy key as written, so postings stored before are still matched", () => {
    expect(legacyFingerprint("Acme", "Product Designer", "Remote - US")).not.toBe(fp("Remote - US"));
    expect(legacyFingerprint("Acme", "Product Designer", "Remote, US")).toBe(fp("Remote, US"));
  });
});

describe("no em dashes in match reasons (#1531)", () => {
  it("turns em and en dashes into commas", () => {
    const r = applyRules({ score: 4, reasonsMatch: ["Design systems — your core strength"], reasonsGap: ["Heavy mobile focus – check fit"], locationFit: true, dealbreaker: false, compMin: 150000, compMax: 180000 }, null)!;
    expect(r.reasonsMatch).toEqual(["Design systems, your core strength"]);
    expect(r.reasonsGap).toEqual(["Heavy mobile focus, check fit"]);
  });
  it("keeps a range between two numbers a range (#1766)", () => {
    const r = applyRules({ score: 4, reasonsMatch: ["Pays $180k–$220k, above your floor", "Salary £90,000 – £110,000"], reasonsGap: ["Hybrid, 2–3 days a week in office", "Series B — 40–60 people"], locationFit: true, dealbreaker: false, compMin: 180000, compMax: 220000 }, null)!;
    expect(r.reasonsMatch).toEqual(["Pays $180k-$220k, above your floor", "Salary £90,000-£110,000"]);
    expect(r.reasonsGap).toEqual(["Hybrid, 2-3 days a week in office", "Series B, 40-60 people"]);
  });
  it("keeps an unspaced en dash between words a range: 'Mon–Fri', 'L5–L6', 'Series A–B' (#1840)", () => {
    expect(noDashes("On-site Mon–Fri")).toBe("On-site Mon-Fri");
    expect(noDashes("Leveled L5–L6")).toBe("Leveled L5-L6");
    expect(noDashes("Series A–B startup")).toBe("Series A-B startup");
    expect(noDashes("Design systems—your core strength")).toBe("Design systems, your core strength");
    expect(noDashes("Heavy mobile focus – check fit")).toBe("Heavy mobile focus, check fit");
  });

  it("keeps an hourly range or a time span a range (#1807)", () => {
    const r = applyRules({ score: 4, reasonsMatch: ["Pays $90/hr – $110/hr", "$60 an hour – $75 an hour", "Core hours 10am–6pm", "Shift 9 a.m. – 5 p.m."], reasonsGap: ["Contract, $50 per hour – $65 per hour", "Team of 5 designers — 3 open roles"], locationFit: true, dealbreaker: false, compMin: 90, compMax: 110 }, null)!;
    expect(r.reasonsMatch).toEqual(["Pays $90/hr-$110/hr", "$60 an hour-$75 an hour", "Core hours 10am-6pm", "Shift 9 a.m.-5 p.m."]);
    expect(r.reasonsGap).toEqual(["Contract, $50 per hour-$65 per hour", "Team of 5 designers, 3 open roles"]);
  });
});

describe("listPage: search and board pages are not jobs (#1537)", () => {
  it("drops Wellfound role and location list pages, not its postings (#1577)", () => {
    for (const u of ["https://wellfound.com/role/l/product-designer/new-york", "https://wellfound.com/role/r/product-designer", "https://wellfound.com/location/new-york"])
      expect(listPage(u), u).toBe(true);
    for (const u of ["https://wellfound.com/jobs/3123456-senior-product-designer", "https://wellfound.com/company/acme/jobs/3123456-senior-product-designer"])
      expect(listPage(u), u).toBe(false);
  });

  it("drops job board search pages, on any country site", () => {
    for (const u of [
      "https://www.glassdoor.com/Job/new-york-ny-ux-director-jobs-SRCH_IL.0,11_IC1132348_KO12,23.htm",
      "https://www.glassdoor.co.uk/Job/london-ux-director-jobs-SRCH_IL.0,6_IC2671300.htm",
      "https://www.indeed.com/l-New-York,-NY-jobs.html",
      "https://www.indeed.com/q-UX-Director-jobs.html",
      "https://uk.indeed.com/jobs?q=ux+director",
      "https://www.indeed.co.uk/jobs?q=ux+director",
      "https://ca.linkedin.com/jobs/ux-director-jobs",
      "https://www.linkedin.com/jobs/search?keywords=ux%20director&location=New%20York",
      "https://www.linkedin.com/jobs/",
      "https://www.ziprecruiter.com/Jobs/UX-Director",
      "https://www.simplyhired.com/search?q=ux+director",
      "https://careers.acme.com/jobs/",
    ])
      expect(listPage(u), u).toBe(true);
  });

  it("drops Built In, Dice, YC, RemoteOK and We Work Remotely list pages, not their postings (#1614)", () => {
    for (const u of [
      "https://www.builtinnyc.com/jobs/design-ux",
      "https://builtin.com/jobs/remote/design-ux",
      "https://builtin.com/jobs?search=product+designer",
      "https://www.dice.com/jobs?q=designer",
      "https://www.ycombinator.com/jobs/role/design",
      "https://www.ycombinator.com/jobs",
      "https://remoteok.com/remote-design-jobs",
      "https://weworkremotely.com/categories/remote-design-jobs",
    ])
      expect(listPage(u), u).toBe(true);
    for (const u of [
      "https://builtin.com/job/product-designer/123456",
      "https://www.builtinnyc.com/job/senior-product-designer/987654",
      "https://www.dice.com/job-detail/0c3f1a2b-4d5e-6f70-8a9b-0c1d2e3f4a5b",
      "https://www.ycombinator.com/companies/acme/jobs/AbC123-product-designer",
      "https://remoteok.com/remote-jobs/123456-remote-product-designer-acme",
      "https://weworkremotely.com/remote-jobs/acme-product-designer",
    ])
      expect(listPage(u), u).toBe(false);
  });

  it("drops an ATS board home that names no job", () => {
    for (const u of [
      "https://jobs.lever.co/acme",
      "https://jobs.eu.lever.co/acme?team=Design",
      "https://job-boards.greenhouse.io/acme",
      "https://boards.greenhouse.io/embed/job_board?for=acme",
      "https://jobs.ashbyhq.com/acme",
      "https://acme.wd1.myworkdayjobs.com/External",
      "https://acme.wd1.myworkdayjobs.com/en-US/External?q=design",
      "https://wd3.myworkdaysite.com/recruiting/acme/External",
    ])
      expect(listPage(u), u).toBe(true);
  });

  it("drops a company's job search with a query, not a job its query names (#1806)", () => {
    for (const u of [
      "https://acme.com/jobs?page=2",
      "https://careers.acme.com/jobs/?location=New%20York",
      "https://www.metacareers.com/jobs?q=designer&teams[0]=Design",
      "https://acme.com/careers/jobs?department=design&sort=new",
    ])
      expect(listPage(u), u).toBe(true);
    for (const u of [
      "https://acme.com/careers/jobs?gh_jid=4001234005",
      "https://acme.com/jobs?jobId=abc12",
      "https://acme.com/jobs?id=r-55",
      "https://acme.com/jobs?job=senior-product-designer",
      "https://acme.com/jobs?req=R123",
      "https://acme.com/jobs?ref=12345",
      "https://acme.com/jobs?utm_source=x&opening=0c3f1a2b-4d5e-6f70-8a9b-0c1d2e3f4a5b",
    ])
      expect(listPage(u), u).toBe(false);
  });

  it("drops a company's careers home and search, not a job under it (#1820)", () => {
    for (const u of [
      "https://acme.com/careers",
      "https://www.acme.com/careers/",
      "https://acme.com/careers?team=design",
      "https://acme.com/careers/search",
      "https://acme.com/job-search?q=designer",
      "https://acme.com/open-positions",
      "https://acme.com/en/careers/open-roles",
      "https://careers.acme.com/",
      "https://jobs.acme.co.uk",
    ])
      expect(listPage(u), u).toBe(true);
    for (const u of [
      "https://acme.com/careers/product-designer-1234",
      "https://acme.com/careers?gh_jid=4001234005",
      "https://acme.com/careers/?jobId=abc12",
      "https://acme.com/careers#/jobs/123",
      "https://careers.acme.com/job/senior-designer",
      "https://careers.acme.com/?id=r-55",
    ])
      expect(listPage(u), u).toBe(false);
  });

  it("drops a Phenom careers home and search and more list paths, not a job under them (#1857)", () => {
    for (const u of [
      "https://careers.acme.com/us/en",
      "https://careers.acme.com/us/en/",
      "https://careers.acme.com/en-gb",
      "https://careers.acme.com/us/en/search-results",
      "https://careers.acme.com/us/en/search-results?keywords=designer",
      "https://acme.com/jobs/search",
      "https://acme.com/careers/all-jobs",
      "https://acme.com/careers/job-listings",
      "https://acme.com/careers/positions",
    ])
      expect(listPage(u), u).toBe(true);
    for (const u of [
      "https://careers.acme.com/us/en/job/R12345/Product-Designer",
      "https://careers.acme.com/us/en/job/R12345",
      "https://careers.acme.com/design",
      "https://acme.com/careers/positions/product-designer",
      "https://careers.acme.com/role",
      "https://careers.acme.com/us/en/design",
    ])
      expect(listPage(u), u).toBe(false);
  });

  it("drops an Oracle Recruiting Cloud or Avature board, not a posting there (#1881)", () => {
    const oc = "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX";
    for (const u of [oc, `${oc}/`, `${oc}/requisitions`, `${oc}/requisitions?keyword=designer&mode=location`, "https://ea.avature.net/en_US/careers/SearchJobs", "https://ea.avature.net/careers/SearchJobs/?keyword=designer"])
      expect(listPage(u), u).toBe(true);
    for (const u of [
      `${oc}/job/12345`,
      `${oc}/job/12345/?utm_medium=jobshare`,
      `${oc}/requisitions/preview/12345`,
      "https://acme.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome",
      "https://ea.avature.net/en_US/careers/JobDetail/Senior-UX-Designer/12345",
      "https://ea.avature.net/careers/JobDetail?jobId=12345",
    ])
      expect(listPage(u), u).toBe(false);
  });

  it("drops a careers site's /search/ page with a query, not a job named in it (#1882)", () => {
    for (const u of [
      "https://careers.acme.com/search/?q=designer&locationsearch=",
      "https://jobs.acme.com/search/?q=&sortColumn=referencedate&sortDirection=desc",
      "https://acme.com/search/",
      "https://acme.com/en/search",
    ])
      expect(listPage(u), u).toBe(true);
    for (const u of [
      "https://careers.acme.com/search/?jobId=12345",
      "https://careers.acme.com/search/?q=designer&req=4012345",
      "https://careers.acme.com/job/New-York-Product-Designer-NY-10001/1234567/",
      "https://acme.com/careers/search-designer",
    ])
      expect(listPage(u), u).toBe(false);
  });

  it("keeps single postings, on those sites too", () => {
    for (const u of [
      "https://www.glassdoor.com/job-listing/ux-director-acme-JV_IC1132348_KO0,11_KE12,16.htm?jl=1009",
      "https://www.indeed.com/viewjob?jk=abc123",
      "https://www.linkedin.com/jobs/view/4012345678",
      "https://www.linkedin.com/jobs/view/senior-ux-director-at-acme-4012345678",
      "https://ca.linkedin.com/jobs/view/ux-director-at-acme-4012345678?trk=public_jobs",
      "https://jobs.lever.co/acme/0c3f1a2b-4d5e-6f70-8a9b-0c1d2e3f4a5b",
      "https://jobs.lever.co/acme/0c3f1a2b-4d5e-6f70-8a9b-0c1d2e3f4a5b/apply",
      "https://job-boards.greenhouse.io/acme/jobs/4001234005",
      "https://boards.greenhouse.io/embed/job_app?for=acme&token=4001234005",
      "https://jobs.ashbyhq.com/acme/0c3f1a2b-4d5e-6f70-8a9b-0c1d2e3f4a5b",
      "https://acme.wd1.myworkdayjobs.com/en-US/External/job/New-York-NY/UX-Director_R12345",
      "https://wd3.myworkdaysite.com/recruiting/acme/External/job/New-York/UX-Director_R12345",
      "https://careers.acme.com/jobs/101-ux-director",
      "not a url",
    ])
      expect(listPage(u), u).toBe(false);
  });

  it("drops SmartRecruiters, Workable, Teamtailor, iCIMS, Taleo and Paylocity board pages, not their postings (#1613)", () => {
    for (const u of [
      "https://careers.smartrecruiters.com/Acme",
      "https://jobs.smartrecruiters.com/Acme",
      "https://apply.workable.com/acme/",
      "https://acme.teamtailor.com/",
      "https://acme.teamtailor.com/departments/design",
      "https://careers-acme.icims.com/jobs/intro",
      "https://acme.taleo.net/careersection/2/jobsearch.ftl",
      "https://recruiting.paylocity.com/Recruiting/Jobs/All/0c3f1a2b-4d5e-6f70-8a9b-0c1d2e3f4a5b/Acme-Inc",
      "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL",
    ])
      expect(listPage(u), u).toBe(true);
    for (const u of [
      "https://jobs.smartrecruiters.com/Acme/743999912345678-product-designer",
      "https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/0c3f1a2b-4d5e-6f70-8a9b-0c1d2e3f4a5b",
      "https://apply.workable.com/acme/j/ABC123DEF/",
      "https://acme.workable.com/jobs/123456",
      "https://jobs.workable.com/view/abc/product-designer-at-acme",
      "https://acme.teamtailor.com/jobs/12345-designer",
      "https://careers-acme.icims.com/jobs/1234/designer/job",
      "https://acme.taleo.net/careersection/2/jobdetail.ftl?job=ABC",
      "https://chk.tbe.taleo.net/chk01/ats/careers/v2/viewRequisition?org=ACME&cws=39&rid=1234",
      "https://recruiting.paylocity.com/Recruiting/Jobs/Details/123456",
      "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345",
    ])
      expect(listPage(u), u).toBe(false);
  });

  it("drops BambooHR, Recruitee, Personio, JazzHR and Jobvite board homes, not their postings (#1812)", () => {
    for (const u of [
      "https://acme.bamboohr.com/careers",
      "https://acme.bamboohr.com/careers/",
      "https://acme.recruitee.com/",
      "https://acme.recruitee.com/?department=design",
      "https://acme.jobs.personio.de/",
      "https://acme.jobs.personio.com/?language=en",
      "https://acme.applytojob.com/",
      "https://acme.applytojob.com/apply",
      "https://acme.applytojob.com/apply/jobs",
      "https://jobs.jobvite.com/acme",
      "https://jobs.jobvite.com/acme/search?q=design",
    ])
      expect(listPage(u), u).toBe(true);
    for (const u of [
      "https://acme.bamboohr.com/careers/123",
      "https://acme.bamboohr.com/careers/123?source=linkedin",
      "https://acme.bamboohr.com/jobs/view.php?id=45",
      "https://acme.recruitee.com/o/product-designer",
      "https://acme.recruitee.com/o/product-designer/c/new",
      "https://acme.jobs.personio.de/job/123456",
      "https://acme.jobs.personio.de/job/123456?language=en&display=en",
      "https://acme.applytojob.com/apply/AbC123xYz/Product-Designer",
      "https://jobs.jobvite.com/acme/job/oAbC123x",
      "https://jobs.jobvite.com/acme/job/oAbC123x/apply",
    ])
      expect(listPage(u), u).toBe(false);
  });

  it("drops a Rippling board home, not its postings (#1902)", () => {
    for (const u of ["https://ats.rippling.com/acme", "https://ats.rippling.com/acme/", "https://ats.rippling.com/en-GB/acme", "https://ats.rippling.com/acme/jobs"])
      expect(listPage(u), u).toBe(true);
    for (const u of [
      "https://ats.rippling.com/acme/jobs/1b2c3d4e-1111-2222-3333-444455556666",
      "https://ats.rippling.com/en-GB/acme/jobs/1b2c3d4e-1111-2222-3333-444455556666",
      "https://ats.rippling.com/acme/jobs/1b2c3d4e-1111-2222-3333-444455556666/apply?step=application",
    ])
      expect(listPage(u), u).toBe(false);
  });

  it("drops Gem, Breezy HR, Pinpoint, Polymer and Trakstar Hire board homes, not their postings (#1856)", () => {
    for (const u of [
      "https://jobs.gem.com/acme",
      "https://jobs.gem.com/acme/",
      "https://acme.breezy.hr/",
      "https://acme.breezy.hr/?department=design",
      "https://acme.pinpointhq.com/",
      "https://acme.pinpointhq.com/en",
      "https://acme.pinpointhq.com/postings",
      "https://jobs.polymer.co/acme",
      "https://acme.hire.trakstar.com/",
      "https://acme.hire.trakstar.com/jobs",
    ])
      expect(listPage(u), u).toBe(true);
    for (const u of [
      "https://jobs.gem.com/acme/am9icG9zdDo0NjU3",
      "https://acme.breezy.hr/p/1a2b3c4d5e6f-product-designer",
      "https://acme.breezy.hr/p/1a2b3c4d5e6f-product-designer/apply",
      "https://acme.pinpointhq.com/postings/1b2c3d4e-1111-2222-3333-444455556666",
      "https://acme.pinpointhq.com/en/postings/1b2c3d4e-1111-2222-3333-444455556666",
      "https://jobs.polymer.co/acme/12345",
      "https://acme.hire.trakstar.com/jobs/fk0abc/",
    ])
      expect(listPage(u), u).toBe(false);
  });
});

describe("jobPageUrl: a board search link that names one job is that job (#1813)", () => {
  it("turns LinkedIn, Indeed and Glassdoor search links into the job's own page, on the same country site", () => {
    expect(jobPageUrl("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3912345678")).toBe("https://www.linkedin.com/jobs/view/3912345678/");
    expect(jobPageUrl("https://uk.linkedin.com/jobs/search/?currentJobId=3912345678&keywords=designer")).toBe("https://uk.linkedin.com/jobs/view/3912345678/");
    expect(jobPageUrl("https://www.indeed.com/jobs?q=designer&vjk=0123456789abcdef")).toBe("https://www.indeed.com/viewjob?jk=0123456789abcdef");
    expect(jobPageUrl("https://uk.indeed.com/jobs?q=designer&l=London&vjk=0123456789ABCDEF")).toBe("https://uk.indeed.com/viewjob?jk=0123456789abcdef");
    expect(jobPageUrl("https://www.glassdoor.com/Job/new-york-designer-jobs-SRCH_IL.0,8.htm?jl=1009123456")).toBe(
      "https://www.glassdoor.com/partner/jobListing.htm?jobListingId=1009123456",
    );
  });

  it("keeps the job's own page and every other link as written", () => {
    for (const u of [
      "https://www.linkedin.com/jobs/view/product-designer-at-acme-3912345678",
      "https://www.indeed.com/viewjob?jk=0123456789abcdef&from=serp",
      "https://www.glassdoor.com/partner/jobListing.htm?jobListingId=1009123456&pos=101",
      "https://www.linkedin.com/jobs/search/?keywords=designer",
      "https://www.indeed.com/jobs?q=designer",
      "https://job-boards.greenhouse.io/acme/jobs/4012345",
      "https://acme.com/careers/jobs",
      "not a url",
    ])
      expect(jobPageUrl(u), u).toBe(u);
  });

  it("is read as one job, not a list page, and keys like the job's own page", () => {
    for (const u of [
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3912345678",
      "https://www.indeed.com/jobs?q=designer&vjk=0123456789abcdef",
      "https://www.glassdoor.com/Job/new-york-designer-jobs-SRCH_IL.0,8.htm?jl=1009123456",
    ]) {
      expect(listPage(u), u).toBe(true);
      expect(listPage(jobPageUrl(u)), u).toBe(false);
      expect(jobKey(jobPageUrl(u)), u).toBe(jobKey(u));
    }
  });
});
