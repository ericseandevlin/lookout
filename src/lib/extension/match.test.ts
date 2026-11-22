import { describe, expect, it } from "vitest";
import { jobKey, sameJob } from "./match";
import { normUrl } from "@/lib/agent/rules";

describe("jobKey (#169)", () => {
  it("reduces every Greenhouse URL for one job to the same key", () => {
    for (const u of [
      "https://www.redventures.com/careers/positions/open?gh_jid=8008090",
      "https://job-boards.greenhouse.io/embed/job_app?for=redventures&token=8008090",
      "https://boards.greenhouse.io/redventures/jobs/8008090",
      "https://job-boards.greenhouse.io/redventures/jobs/8008090?gh_src=abc",
    ])
      expect(jobKey(u)).toBe("greenhouse:8008090");
  });
  it("keys Ashby and Lever by the posting id, with or without /application", () => {
    expect(jobKey("https://jobs.ashbyhq.com/understood/0B5F3A1C-2D4E-4F60-8A7B-9C0D1E2F3A4B/application")).toBe("ashby:0b5f3a1c-2d4e-4f60-8a7b-9c0d1e2f3a4b");
    expect(jobKey("https://jobs.lever.co/acme/0b5f3a1c-2d4e-4f60-8a7b-9c0d1e2f3a4b/apply")).toBe("lever:0b5f3a1c-2d4e-4f60-8a7b-9c0d1e2f3a4b");
  });
  it("falls back to host and path, ignoring www, query, trailing slash and /apply", () => {
    expect(jobKey("https://www.example.com/Jobs/42/apply/?ref=x")).toBe("url:example.com/jobs/42");
  });
  it("keeps a job ID that lives in the query, and drops tracking params (#508)", () => {
    expect(jobKey("https://www.indeed.com/viewjob?jk=abc123&from=serp&utm_source=x")).toBe("url:indeed.com/viewjob?jk=abc123");
    expect(jobKey("https://careers.example.com/job?ref=li&jobId=R-42")).toBe("url:careers.example.com/job?jobid=r-42");
    expect(jobKey("https://careers.example.com/job?job_id=R-42")).toBe(jobKey("https://careers.example.com/job?jobId=R-42&src=mail"));
  });
  it("keys an Indeed or LinkedIn posting by its job ID, however the link is written (#1578)", () => {
    const jk = "indeed:0a1b2c3d4e5f6789";
    for (const u of [
      "https://www.indeed.com/viewjob?jk=0a1b2c3d4e5f6789",
      "https://www.indeed.com/viewjob?jk=0A1B2C3D4E5F6789&from=serp&vjs=3",
      "https://indeed.com/viewjob?from=serp&tk=1h2j3k&jk=0a1b2c3d4e5f6789&advn=123",
      "https://www.indeed.com/jobs?q=designer&vjk=0a1b2c3d4e5f6789",
    ])
      expect(jobKey(u), u).toBe(jk);
    expect(jobKey("https://www.indeed.com/viewjob?jk=1111111111111111")).not.toBe(jk);
    const li = "linkedin:3812345678";
    for (const u of [
      "https://www.linkedin.com/jobs/view/3812345678",
      "https://www.linkedin.com/jobs/view/3812345678/?trk=public_jobs",
      "https://www.linkedin.com/jobs/view/senior-product-designer-at-acme-3812345678",
      "https://uk.linkedin.com/jobs/view/senior-product-designer-at-acme-3812345678/",
    ])
      expect(jobKey(u), u).toBe(li);
    expect(jobKey("https://www.linkedin.com/jobs/search?keywords=designer")).toMatch(/^url:/);
  });
  it("keys a LinkedIn job open beside a search or collection like its own page (#1583)", () => {
    for (const u of [
      "https://www.linkedin.com/jobs/search/?currentJobId=3812345678&keywords=designer",
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3812345678",
      "https://ca.linkedin.com/jobs/search?geoId=101174742&currentJobId=3812345678",
    ])
      expect(jobKey(u), u).toBe("linkedin:3812345678");
    expect(sameJob(["https://www.linkedin.com/jobs/search/?currentJobId=3812345678"], ["https://www.linkedin.com/jobs/view/3812345678/"])).toBe(true);
    expect(jobKey("https://www.linkedin.com/jobs/search/?currentJobId=abc")).toMatch(/^url:/);
    expect(jobKey("https://example.com/jobs?currentJobId=3812345678")).toMatch(/^url:/);
  });
  it("keys a Workday job by tenant and job slug, ignoring locale and the apply steps (#622)", () => {
    const post = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Senior-Designer_R12345";
    const key = "workday:acme.wd5.myworkdayjobs.com:senior-designer_r12345";
    for (const u of [post, `${post}/`, `${post}/apply`, `${post}/apply/applyManually`, `${post}/apply/autofillWithResume?source=x`, "https://acme.wd5.myworkdayjobs.com/External/job/New-York-NY/Senior-Designer_R12345/apply", "https://acme.wd5.myworkdayjobs.com/en-US/External/details/Senior-Designer_R12345"]) {
      expect(jobKey(u), u).toBe(key);
    }
    expect(jobKey("https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Senior-Designer_R67890")).not.toBe(key);
    expect(jobKey("https://other.wd1.myworkdayjobs.com/External/job/New-York-NY/Senior-Designer_R12345")).not.toBe(key);
    expect(jobKey("https://acme.wd5.myworkdayjobs.com/en-US/External")).toBe("url:acme.wd5.myworkdayjobs.com/en-us/external");
  });

  it("keys a Workday title that starts with Apply on the title, not the location (1107)", () => {
    const post = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Apply-Engineer_R5";
    const key = "workday:acme.wd5.myworkdayjobs.com:apply-engineer_r5";
    for (const u of [post, `${post}/`, `${post}/apply`, `${post}/apply/applyManually`]) expect(jobKey(u), u).toBe(key);
    expect(jobKey("https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Applied-Scientist_R6")).not.toBe(key);
  });

  it("keys Workday jobs on myworkdaysite.com by tenant too (#666)", () => {
    const post = "https://wd3.myworkdaysite.com/en-US/recruiting/acme/Careers/job/Newark-NJ/Senior-Designer_R12345";
    const key = "workday:wd3.myworkdaysite.com/acme:senior-designer_r12345";
    for (const u of [post, `${post}/apply/applyManually`, "https://wd3.myworkdaysite.com/recruiting/acme/Careers/job/Newark-NJ/Senior-Designer_R12345/apply"]) expect(jobKey(u), u).toBe(key);
    expect(jobKey("https://wd3.myworkdaysite.com/recruiting/other/Careers/job/Newark-NJ/Senior-Designer_R12345")).not.toBe(key);
  });
  it("returns null for junk", () => {
    expect(jobKey("not a url")).toBeNull();
    expect(jobKey(undefined)).toBeNull();
  });
});

describe("sameJob", () => {
  it("matches when an embedded frame is the application's job", () => {
    expect(sameJob(["https://www.redventures.com/careers", "https://job-boards.greenhouse.io/embed/job_app?for=redventures&token=8008090"], ["https://www.redventures.com/careers/positions/open?gh_jid=8008090"])).toBe(true);
  });
  it("does not match a different job on the same board", () => {
    expect(sameJob(["https://boards.greenhouse.io/redventures/jobs/1"], ["https://boards.greenhouse.io/redventures/jobs/2"])).toBe(false);
  });
  it("keys a company page that embeds Ashby by its ?ashby_jid= (#639)", () => {
    const id = "0b5f3a1c-2d4e-4f60-8a7b-9c0d1e2f3a4b";
    expect(jobKey(`https://acme.com/careers?ashby_jid=${id.toUpperCase()}&utm_source=x`)).toBe(`ashby:${id}`);
    expect(sameJob([`https://acme.com/careers?ashby_jid=${id}`], [`https://jobs.ashbyhq.com/acme/${id}`])).toBe(true);
    expect(sameJob([`https://acme.com/careers?ashby_jid=${id}`], ["https://acme.com/careers?ashby_jid=1b5f3a1c-2d4e-4f60-8a7b-9c0d1e2f3a4b"])).toBe(false);
  });
  it("does not match two Indeed jobs that differ only by ?jk= (#508)", () => {
    expect(sameJob(["https://www.indeed.com/viewjob?jk=abc123"], ["https://www.indeed.com/viewjob?jk=def456"])).toBe(false);
    expect(sameJob(["https://www.indeed.com/viewjob?jk=abc123&from=serp"], ["https://indeed.com/viewjob?jk=abc123"])).toBe(true);
  });
  it("tells UltiPro jobs apart by ?opportunityId= (#840)", () => {
    const up = (id: string) => `https://recruiting.ultipro.com/ACM1000ACME/JobBoard/abc-123/OpportunityDetail?opportunityId=${id}`;
    expect(sameJob([up("11111111-2222-3333-4444-555555555555")], [up("99999999-2222-3333-4444-555555555555")])).toBe(false);
    expect(sameJob([up("11111111-2222-3333-4444-555555555555").replace("opportunityId", "opportunityid")], [up("11111111-2222-3333-4444-555555555555")])).toBe(true);
  });
  it("tells SuccessFactors jobs apart by ?career_job_req_id= (#840)", () => {
    const sf = (id: number, extra = "") => `https://career4.successfactors.com/career?company=acme&career_ns=job_listing${extra}&career_job_req_id=${id}`;
    expect(sameJob([sf(101)], [sf(202)])).toBe(false);
    expect(sameJob([sf(101, "&navBarLevel=JOB_SEARCH")], [sf(101)])).toBe(true);
  });
  it("tells two employers' jobs apart on a shared SuccessFactors or Brassring host (#895)", () => {
    const sf = (co: string) => `https://career4.successfactors.com/career?company=${co}&career_job_req_id=1234`;
    expect(sameJob([sf("globexP")], [sf("acmeP")])).toBe(false);
    expect(sameJob([sf("ACMEP") + "&career_ns=job_application"], [sf("acmeP")])).toBe(true);
    const br = (partner: string) => `https://sjobs.brassring.com/TGnewUI/Search/home/HomeWithPreLoad?partnerid=${partner}&siteid=5016&jobid=1234`;
    expect(sameJob([br("25678")], [br("12345")])).toBe(false);
    expect(sameJob([br("12345")], [br("12345")])).toBe(true);
    // An employer param alone names no job, so it does not change the key.
    expect(jobKey("https://career4.successfactors.com/career?company=acmeP")).toBe("url:career4.successfactors.com/career");
  });
  it("keeps a hash route as part of the job, but not a plain anchor (#841)", () => {
    expect(sameJob(["https://careers.acme.com/#/jobs/101"], ["https://careers.acme.com/#/jobs/202"])).toBe(false);
    expect(sameJob(["https://careers.acme.com/#!/job/101/apply"], ["https://careers.acme.com/#!/job/101"])).toBe(true);
    expect(sameJob(["https://jobs.example.com/acme/123#apply"], ["https://jobs.example.com/acme/123"])).toBe(true);
  });
  it("keys an iCIMS job by host and job number through its login and apply steps (#852)", () => {
    const job = "https://careers-acme.icims.com/jobs/1234/senior-designer/job";
    expect(jobKey(job)).toBe("icims:careers-acme.icims.com:1234");
    expect(sameJob(["https://careers-acme.icims.com/jobs/1234/senior-designer/login?in_iframe=1"], [job])).toBe(true);
    expect(sameJob(["https://careers-acme.icims.com/jobs/1234/senior-designer/candidate?mode=job&iis=Indeed"], [job])).toBe(true);
    expect(sameJob(["https://careers-acme.icims.com/jobs/5678/senior-designer/job"], [job])).toBe(false);
    expect(sameJob(["https://careers-other.icims.com/jobs/1234/senior-designer/job"], [job])).toBe(false);
    // The search list isn't one job.
    expect(jobKey("https://careers-acme.icims.com/jobs/search?ss=1")).toMatch(/^url:/);
  });
  it("matches Taleo and UltiPro forms to their postings (#1497)", () => {
    const taleo = "https://acme.taleo.net/careersection/2/jobdetail.ftl?job=12345&lang=en";
    expect(jobKey(taleo)).toBe("taleo:acme.taleo.net:12345");
    expect(sameJob(["https://acme.taleo.net/careersection/2/jobapply.ftl?job=12345&lang=en"], [taleo])).toBe(true);
    expect(sameJob(["https://acme.taleo.net/careersection/2/jobapply.ftl?job=99999&lang=en"], [taleo])).toBe(false);
    const ulti = "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0b6b7c8e-1a2b-4c3d-9e8f-123456789abc/OpportunityDetail?opportunityId=1f2e3d4c-5b6a-4789-8abc-def012345678";
    expect(sameJob([ulti.replace("OpportunityDetail", "OpportunityApply")], [ulti])).toBe(true);
    expect(sameJob([ulti.replace("OpportunityDetail", "OpportunityApply").replace("1f2e3d4c", "aaaaaaaa")], [ulti])).toBe(false);
  });

  it("matches a Paylocity form to its posting by job ID (#1435)", () => {
    const job = "https://recruiting.paylocity.com/Recruiting/Jobs/Details/1234567";
    expect(jobKey(job)).toBe("paylocity:1234567");
    expect(sameJob(["https://recruiting.paylocity.com/Recruiting/Jobs/Apply/1234567"], [job])).toBe(true);
    expect(sameJob(["https://recruiting.paylocity.com/recruiting/jobs/apply/1234567?source=LinkedIn"], [job])).toBe(true);
    expect(sameJob(["https://recruiting.paylocity.com/Recruiting/Jobs/Apply/7654321"], [job])).toBe(false);
    // A company's job list isn't one job.
    expect(jobKey("https://recruiting.paylocity.com/Recruiting/Jobs/All/abc-123")).toMatch(/^url:/);
  });

  it("keys a SmartRecruiters posting by its ID, with or without the title slug, on either host (#1520)", () => {
    const job = "https://jobs.smartrecruiters.com/Acme/743999912345678-product-designer";
    expect(jobKey(job)).toBe("smartrecruiters:acme:743999912345678");
    expect(sameJob(["https://jobs.smartrecruiters.com/Acme/743999912345678"], [job])).toBe(true);
    expect(sameJob(["https://careers.smartrecruiters.com/acme/743999912345678-product-designer/?trid=abc"], [job])).toBe(true);
    // Retitled: the slug changed, the ID did not.
    expect(sameJob(["https://jobs.smartrecruiters.com/Acme/743999912345678-senior-product-designer"], [job])).toBe(true);
    expect(sameJob(["https://jobs.smartrecruiters.com/Acme/743999912399999-product-designer"], [job])).toBe(false);
    expect(sameJob(["https://jobs.smartrecruiters.com/Other/743999912345678-product-designer"], [job])).toBe(false);
    // A company's job list isn't one job.
    expect(jobKey("https://careers.smartrecruiters.com/Acme")).toMatch(/^url:/);
    expect(jobKey("https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/1b2c3d4e-1111-2222-3333-444455556666")).toMatch(/^url:/);
  });
});

describe("Recruitee and Teamtailor apply steps (#1200)", () => {
  it("matches the form page to its posting", () => {
    const rc = "https://acme.recruitee.com/o/senior-product-designer";
    expect(sameJob(["https://acme.recruitee.com/o/senior-product-designer/c/new"], [rc])).toBe(true);
    expect(sameJob(["https://acme.recruitee.com/o/staff-designer/c/new"], [rc])).toBe(false);
    const tt = "https://career.acme.com/jobs/4521337-senior-product-designer";
    expect(sameJob(["https://career.acme.com/jobs/4521337-senior-product-designer/applications/new"], [tt])).toBe(true);
    expect(sameJob(["https://acme.teamtailor.com/jobs/4521337-senior-product-designer/applications/new/"], ["https://acme.teamtailor.com/jobs/4521337-senior-product-designer"])).toBe(true);
    expect(sameJob(["https://career.acme.com/jobs/9999999-staff-designer/applications/new"], [tt])).toBe(false);
  });

  it("keys a Workable job by its shortcode and a Teamtailor job by its ID, slug or not (#1522)", () => {
    const wk = "https://apply.workable.com/acme/j/1A2B3C4D5E/";
    expect(jobKey(wk)).toBe("workable:1a2b3c4d5e");
    expect(sameJob(["https://apply.workable.com/j/1A2B3C4D5E"], [wk])).toBe(true);
    expect(sameJob(["https://acme.workable.com/j/1A2B3C4D5E"], [wk])).toBe(true);
    expect(sameJob(["https://apply.workable.com/acme/j/1A2B3C4D5E/apply/"], [wk])).toBe(true);
    expect(sameJob(["https://apply.workable.com/acme/j/9Z8Y7X6W5V/"], [wk])).toBe(false);
    // The company's job list isn't one job.
    expect(jobKey("https://apply.workable.com/acme/")).toMatch(/^url:/);
    const tt = "https://acme.teamtailor.com/jobs/4521337-senior-product-designer";
    expect(jobKey(tt)).toBe("teamtailor:acme.teamtailor.com:4521337");
    expect(sameJob(["https://acme.teamtailor.com/jobs/4521337"], [tt])).toBe(true);
    expect(sameJob(["https://acme.teamtailor.com/en/jobs/4521337-lead-product-designer/applications/new"], [tt])).toBe(true);
    expect(sameJob(["https://acme.teamtailor.com/jobs/9999999-senior-product-designer"], [tt])).toBe(false);
    expect(sameJob(["https://other.teamtailor.com/jobs/4521337-senior-product-designer"], [tt])).toBe(false);
    expect(jobKey("https://acme.teamtailor.com/jobs")).toMatch(/^url:/);
  });

  it("keeps a path that only ends in new", () => {
    expect(jobKey("https://acme.com/careers/new")).toBe("url:acme.com/careers/new");
  });
});

describe("a link with a bad % escape (#1162)", () => {
  it("still gets a key, never a URIError", () => {
    const wd = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Boston-MA/Sales-Rep--100%-Commission_R123/apply";
    expect(jobKey(wd)).toBe("workday:acme.wd5.myworkdayjobs.com:sales-rep--100%-commission_r123");
    expect(sameJob([wd], [wd])).toBe(true);
    expect(() => jobKey("https://acme.wd1.myworkdayjobs.com/job/Paris/Caf%E9-Manager_R9")).not.toThrow();
    expect(jobKey("https://acme.wd1.myworkdayjobs.com/job/New-York/Senior%20Designer_R1")).toBe("workday:acme.wd1.myworkdayjobs.com:senior designer_r1");
  });
});

describe("a query inside a hash route (#1375)", () => {
  it("drops tracking tags from it, in jobKey and normUrl", () => {
    const plain = "https://careers.acme.com/#/jobs/101";
    const tagged = "https://careers.acme.com/#/jobs/101?utm_source=linkedin&gh_src=abc";
    expect(jobKey(tagged)).toBe(jobKey(plain));
    expect(normUrl(tagged)).toBe(normUrl(plain));
    expect(normUrl(tagged)).toBe("careers.acme.com#/jobs/101");
  });

  it("keeps a job ID param in it, so two jobs stay two", () => {
    expect(jobKey("https://acme.com/#/job?id=101")).not.toBe(jobKey("https://acme.com/#/job?id=202"));
    expect(jobKey("https://acme.com/#/job?id=101&utm_source=x")).toBe(jobKey("https://acme.com/#/job?id=101"));
  });

  it("still drops the apply step before the query", () => {
    expect(jobKey("https://acme.com/#/jobs/101/apply?utm_source=x")).toBe(jobKey("https://acme.com/#/jobs/101"));
  });
});
