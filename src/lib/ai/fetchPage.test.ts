import { describe, expect, it } from "vitest";
import { decodeBody, fetchPage, isPublicIp, pageToText, workdayApi, workdayToHtml } from "./fetchPage";
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
});

describe("Workday postings (#724)", () => {
  it.each([
    ["https://swbc.wd1.myworkdayjobs.com/InformationTechnology/job/Remote/Director-of-Product_R0015578-2", "https://swbc.wd1.myworkdayjobs.com/wday/cxs/swbc/InformationTechnology/job/Remote/Director-of-Product_R0015578-2"],
    ["https://arcticwolf.wd1.myworkdayjobs.com/en-US/External/job/Director--Product---XDR_R26_810?source=x", "https://arcticwolf.wd1.myworkdayjobs.com/wday/cxs/arcticwolf/External/job/Director--Product---XDR_R26_810"],
    ["https://acme.wd503.myworkdayjobs.com/fr-CA/Careers/job/Toronto/PM_1/", "https://acme.wd503.myworkdayjobs.com/wday/cxs/acme/Careers/job/Toronto/PM_1"],
  ])("maps %s to the JSON address", (page, api) => expect(workdayApi(page)).toBe(api));

  it.each([
    "https://swbc.wd1.myworkdayjobs.com/InformationTechnology", // a job list, not a posting
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
