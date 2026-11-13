import { describe, expect, it } from "vitest";
import { jobKey, sameJob } from "./match";

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
});
