import { describe, expect, it } from "vitest";
import { fetchPage, isPublicIp, pageToText } from "./fetchPage";

describe("isPublicIp", () => {
  it.each(["10.0.0.5", "127.0.0.1", "172.17.0.1", "172.19.0.11", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "blocks %s",
    (ip) => expect(isPublicIp(ip)).toBe(false),
  );
  it.each(["8.8.8.8", "104.21.27.138", "2606:4700::1"])("allows %s", (ip) => expect(isPublicIp(ip)).toBe(true));
});

describe("fetchPage refuses internal targets", () => {
  it.each(["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://localhost:3000/", "http://example.com:5432/", "file:///etc/passwd", "http://user:pw@example.com/"])(
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
