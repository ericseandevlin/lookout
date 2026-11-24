import { describe, expect, it } from "vitest";
import { decodeBody, fetchPage, isPublicIp, jobBody, pageToText, workdayApi, workdayToHtml } from "./fetchPage";
import { findPay } from "./pay";

describe("isPublicIp", () => {
  it.each(["10.0.0.5", "127.0.0.1", "172.17.0.1", "172.19.0.11", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "blocks %s",
    (ip) => expect(isPublicIp(ip)).toBe(false),
  );
  it.each(["8.8.8.8", "104.21.27.138", "2606:4700::1"])("allows %s", (ip) => expect(isPublicIp(ip)).toBe(true));

  // #207: IPv4 inside IPv6, in the forms the URL parser and DNS can hand over.
  it.each(["::ffff:7f00:1", "::FFFF:7F00:1", "::ffff:ac11:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:0:0", "::127.0.0.1", "::7f00:1", "64:ff9b::7f00:1", "64:ff9b::a00:1", "64:ff9b:1::808:808", "2002:7f00:1::", "2002:a9fe:a9fe::1", "2001:db8::1", "2001:0:1::1", "fe80::1%eth0", "FD12::1", "ff02::1", "not-an-ip", "1::2::3"])(
    "blocks %s",
    (ip) => expect(isPublicIp(ip)).toBe(false),
  );
  it.each(["::ffff:808:808", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1", "2001:4860:4860::8888"])("allows %s", (ip) => expect(isPublicIp(ip)).toBe(true));

  it("the URL parser's form of a mapped loopback is blocked", () => {
    const host = new URL("http://[::ffff:127.0.0.1]/").hostname.replace(/^\[|\]$/g, "");
    expect(host).toBe("::ffff:7f00:1");
    expect(isPublicIp(host)).toBe(false);
  });
});

describe("fetchPage refuses internal targets", () => {
  it.each(["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://localhost:3000/", "http://example.com:5432/", "file:///etc/passwd", "http://user:pw@example.com/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[64:ff9b::7f00:1]/"])(
    "%s",
    async (u) => {
      await expect(fetchPage(u)).rejects.toThrow();
    },
  );
});

describe("pageToText", () => {
  it("drops dialogs, buttons and lone close marks (#1312)", () => {
    // The Bank of America shape: age and eligibility modals, a referral button and close glyphs around the job.
    const html = `<title>Software Engineer</title>
      <div role="dialog" aria-modal="true"><button>×</button><p>To proceed with your application, you must be at least 18 years of age.</p><button>Acknowledge</button></div>
      <div class="modal" aria-modal="true"><span>✕</span><p>Bank of America employees are required to meet all posting eligibility requirements.</p><a>Acknowledge</a></div>
      <dialog><p>Refer someone</p></dialog>
      <main><h1>Software Engineer</h1><p>Build the payments platform.</p><div>×</div><button>Refer a friend</button><p>Lead code reviews.</p></main>`;
    const t = pageToText(html);
    expect(t).toContain("Build the payments platform.");
    expect(t).toContain("Lead code reviews.");
    for (const chrome of ["18 years of age", "eligibility requirements", "Acknowledge", "Refer a friend", "Refer someone", "×", "✕"]) expect(t).not.toContain(chrome);
  });
  it("keeps a whole job shown inside a dialog (#1312)", () => {
    const job = "Design and build the search service. ".repeat(30);
    const t = pageToText(`<div role="dialog"><h1>Engineer</h1><p>${job}</p><button>Apply</button></div>`);
    expect(t).toContain("Design and build the search service.");
    expect(t).not.toContain("Apply");
  });
  it("keeps JobPosting data and drops scripts", () => {
    const html = `<title>Director of Events</title><script>alert(1)</script>
      <script type="application/ld+json">{"@type":"JobPosting","baseSalary":{"value":{"minValue":140000}}}</script>
      <p>Lead events &amp; banquets.</p>`;
    const t = pageToText(html);
    expect(t).toContain("TITLE: Director of Events");
    expect(t).toContain("JobPosting");
    expect(t).toContain("Lead events & banquets.");
    expect(t).not.toContain("alert(1)");
  });
  it("decodes hex, decimal and named entities in the text and the title (#491)", () => {
    const html = `<title>Engineer &amp;
      Designer</title><p>Don&#x27;t miss it &#8212; we&rsquo;re hiring&hellip; &#128640; &#X41;</p><p>bad &#0; &#xD800; &bogus; end</p>`;
    const t = pageToText(html);
    expect(t).toContain("TITLE: Engineer & Designer");
    expect(t).toContain("Don't miss it — we’re hiring… \u{1F680} A");
    expect(t).toContain("bad end");
  });
  it("strips HTML from JSON-LD description field (#1311)", () => {
    const html = `<title>Senior Engineer</title>
      <script type="application/ld+json">{"@type":"JobPosting","title":"Senior Engineer","description":"Join us!<p><b>Job Description:</b><br />Build the backend.</p><p>We offer benefits.</p>","employmentType":"FULL_TIME"}</script>`;
    const t = pageToText(html);
    expect(t).toContain("STRUCTURED DATA:");
    expect(t).not.toContain("<b>");
    expect(t).not.toContain("</p>");
    expect(t).not.toContain("<br");
    expect(t).toContain("Build the backend.");
    expect(t).toContain("Join us!");
  });
  it("strips HTML from a JobPosting longer than the cut (#1387)", () => {
    const ld = JSON.stringify({ "@type": "JobPosting", title: "Designer", description: "<p>We are hiring.</p>".repeat(400) });
    const t = pageToText(`<title>Job</title><script type="application/ld+json">${ld}</script><p>${"word ".repeat(80)}</p>`, 20000);
    expect(t).toContain("STRUCTURED DATA:");
    expect(t).toContain("We are hiring.");
    expect(t).not.toContain("<p>");
  });
});

describe("Workday postings (#724)", () => {
  it.each([
    ["https://swbc.wd1.myworkdayjobs.com/InformationTechnology/job/Remote/Director-of-Product_R0015578-2", "https://swbc.wd1.myworkdayjobs.com/wday/cxs/swbc/InformationTechnology/job/Remote/Director-of-Product_R0015578-2"],
    ["https://arcticwolf.wd1.myworkdayjobs.com/en-US/External/job/Director--Product---XDR_R26_810?source=x", "https://arcticwolf.wd1.myworkdayjobs.com/wday/cxs/arcticwolf/External/job/Director--Product---XDR_R26_810"],
    ["https://acme.wd503.myworkdayjobs.com/fr-CA/Careers/job/Toronto/PM_1/", "https://acme.wd503.myworkdayjobs.com/wday/cxs/acme/Careers/job/Toronto/PM_1"],
    // A share link: /details/ instead of /job/, same JSON address (#1071).
    ["https://swbc.wd1.myworkdayjobs.com/en-US/InformationTechnology/details/Senior-Network-Security-Engineer_R0015735", "https://swbc.wd1.myworkdayjobs.com/wday/cxs/swbc/InformationTechnology/job/Senior-Network-Security-Engineer_R0015735"],
    // The apply steps are not part of the job's address (#1206).
    ["https://acme.wd5.myworkdayjobs.com/External/job/New-York-NY/Senior-Designer_R12345/apply", "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/job/New-York-NY/Senior-Designer_R12345"],
    ["https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Senior-Designer_R12345/apply/applyManually", "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/job/New-York-NY/Senior-Designer_R12345"],
    ["https://acme.wd5.myworkdayjobs.com/External/job/Apply-Engineer_R5/apply", "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/job/Apply-Engineer_R5"],
  ])("maps %s to the JSON address", (page, api) => expect(workdayApi(page)).toBe(api));

  it.each([
    "https://swbc.wd1.myworkdayjobs.com/InformationTechnology", // a job list, not a posting
    "https://swbc.wd1.myworkdayjobs.com/InformationTechnology/details", // no posting after /details/
    "https://swbc.wd1.myworkdayjobs.com/wday/cxs/swbc/InformationTechnology/job/X_1", // already the JSON address
    "http://swbc.wd1.myworkdayjobs.com/Site/job/X_1",
    "https://myworkdayjobs.com.evil.example/Site/job/X_1",
    "https://boards.greenhouse.io/acme/jobs/1",
    "not a url",
  ])("leaves %s alone", (u) => expect(workdayApi(u)).toBeNull());

  it("turns the posting JSON into a page the reader keeps", () => {
    const html = workdayToHtml(
      JSON.stringify({
        jobPostingInfo: { title: "Director of Product <AI>", jobDescription: "<p>Own the roadmap.</p><p>Pay: $180,000 - $210,000</p>", location: "Remote", timeType: "Full time", postedOn: "Posted 3 Days Ago", jobReqId: "R1", canApply: true },
        hiringOrganization: { name: "Acme & Co" },
      }),
    )!;
    const t = pageToText(html);
    expect(t).toContain("TITLE: Director of Product <AI>");
    // The legal employer is not the name people know.
    expect(t).not.toContain("Acme & Co");
    expect(t).toContain("Location: Remote");
    expect(t).toContain("Own the roadmap.");
    expect(t).not.toContain("no longer accepting");
  });

  it("says so when the posting has closed", () => {
    const html = workdayToHtml(JSON.stringify({ jobPostingInfo: { title: "PM", jobDescription: "<p>x</p>", canApply: false } }))!;
    expect(pageToText(html)).toContain("no longer accepting applications");
  });

  it.each(["{}", "<html>", JSON.stringify({ jobPostingInfo: { title: "PM" } })])("returns null for %s", (j) => expect(workdayToHtml(j)).toBeNull());
});

describe("decodeBody (#1036)", () => {
  // "$150,000 – $200,000" with a windows-1252 en dash (0x96) and a non-breaking space (0xA0).
  const cp1252 = Uint8Array.from([...Buffer.from("<p>$150,000"), 0xa0, 0x96, 0xa0, ...Buffer.from("$200,000 per year</p>")]);

  it("reads the charset from the Content-Type header", () => {
    const html = decodeBody(cp1252, "text/html; charset=windows-1252");
    expect(html).toContain("$150,000\u00a0\u2013\u00a0$200,000");
    expect(findPay(html)).toMatchObject({ min: 150000, max: 200000 });
  });

  it("reads it from a meta tag when the header has none", () => {
    const meta = Uint8Array.from([...Buffer.from('<html><head><meta charset="ISO-8859-1"></head>'), ...cp1252]);
    expect(decodeBody(meta, "text/html")).toContain("\u00a0$200,000");
    const equiv = Uint8Array.from([...Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">'), ...cp1252]);
    expect(decodeBody(equiv, "text/html")).toContain("\u2013");
  });

  it("reads UTF-8 by default and for an unknown label", () => {
    const utf8 = new TextEncoder().encode("<p>Café – $90k</p>");
    expect(decodeBody(utf8, "text/html")).toBe("<p>Café – $90k</p>");
    expect(decodeBody(utf8, "text/html; charset=nonsense-9")).toBe("<p>Café – $90k</p>");
  });
});

describe("a board's own job text box (#1662)", () => {
  const job = "We're looking for an Assistant Controller to lead manufacturing cost accounting, standard costing and variance analysis. ".repeat(3);
  const page = `<html><head><title>Assistant Controller at CFS | LinkedIn Jobs</title></head><body>
    <div class="modal"><p>Agree &amp; Join LinkedIn</p><p>By clicking Continue to join or sign in, you agree to LinkedIn's User Agreement.</p></div>
    <a href="#main">Skip to main content</a><p>Be among the first 25 applicants</p><p>Report this job</p>
    <div class="compensation"><h3>Base pay range</h3><div>$120,000.00/yr - $130,000.00/yr</div></div>
    <div class="description__text description__text--rich"><section class="show-more-less-html">
      <div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-20 relative"><strong>We're Hiring</strong><br><div>${job}</div></div>
    </section></div><p>See who CFS has hired for this role</p></body></html>`;

  it("keeps only the job text, and still reads the pay box outside it", () => {
    const t = pageToText(page);
    expect(t).toContain("lead manufacturing cost accounting");
    for (const junk of ["Agree & Join", "Skip to main content", "Report this job", "first 25 applicants", "See who CFS has hired"]) expect(t).not.toContain(junk);
    expect(t).toContain("PAY ON PAGE");
  });

  it("uses the whole page when the box is missing or nearly empty", () => {
    expect(jobBody("<div><p>Plain posting</p></div>")).toBeNull();
    expect(jobBody('<div class="show-more-less-html__markup">Short</div>')).toBeNull();
  });
});
