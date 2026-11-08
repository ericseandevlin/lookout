import { describe, expect, it } from "vitest";
import { hrefOf } from "./links";
import { LinkUrl } from "./validators";

describe("LinkUrl", () => {
  it("takes plain links and trims them", () => {
    expect(LinkUrl.parse("https://ericdevlin.co")).toBe("https://ericdevlin.co");
    expect(LinkUrl.parse("  ericdevlin.co/work ")).toBe("ericdevlin.co/work");
  });

  it("refuses script and local schemes in any case, even after spaces", () => {
    for (const u of ["javascript:alert(1)", "JavaScript:alert(1)", "  javascript:alert(1)", "data:text/html,hi", "vbscript:x", "file:///etc/passwd"]) {
      expect(LinkUrl.safeParse(u).success, u).toBe(false);
    }
  });

  it("refuses links that are too short or too long", () => {
    expect(LinkUrl.safeParse("ab").success).toBe(false);
    expect(LinkUrl.safeParse("https://a.co/" + "x".repeat(500)).success).toBe(false);
  });

  it("a scheme split by a tab or newline gets through, but hrefOf makes it an https link", () => {
    // Browsers drop tabs and newlines inside URLs, so the link must never reach an href as-is.
    for (const u of ["java\tscript:alert(1)", "java\nscript:alert(1)"]) {
      expect(LinkUrl.safeParse(u).success).toBe(true);
      expect(hrefOf(LinkUrl.parse(u))).toMatch(/^https:\/\//);
    }
  });
});
