import { describe, expect, it } from "vitest";
import { stripHtml } from "./entities";

describe("stripHtml (#1311)", () => {
  // The shape seen on a Bank of America posting's structured data.
  const boa = "Join us!</p><p></p><p><b>Job Description:</b><br />This job is responsible for the platform.</p><ul><li>Build services</li><li>Lead reviews</li></ul>";

  it("turns block tags into lines and drops the rest", () => {
    expect(stripHtml(boa)).toBe("Join us!\nJob Description:\nThis job is responsible for the platform.\nBuild services\nLead reviews");
  });

  it("decodes entity-encoded HTML, then strips it", () => {
    const encoded = boa.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    expect(stripHtml(encoded)).toBe(stripHtml(boa));
    expect(stripHtml("&lt;p&gt;Salary: $120k &amp;amp; equity&lt;/p&gt;")).not.toMatch(/<|&lt;/);
  });

  it("leaves plain text alone, entities decoded", () => {
    expect(stripHtml("Design &amp; build. Pay: 5 &lt; 6")).toBe("Design & build. Pay: 5 < 6");
    expect(stripHtml("Already plain text.\nSecond line.")).toBe("Already plain text.\nSecond line.");
  });

  it("drops scripts and styles", () => {
    expect(stripHtml("<p>Keep</p><script>var x = 1;</script><style>p{}</style>")).toBe("Keep");
  });
});
