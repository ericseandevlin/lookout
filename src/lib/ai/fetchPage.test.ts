import { describe, expect, it } from "vitest";
import { fetchPage, isPublicIp, pageToText } from "./fetchPage";

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
});
