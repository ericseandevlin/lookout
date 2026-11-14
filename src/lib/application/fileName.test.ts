import { describe, expect, it } from "vitest";
import { attachment, fileSafe } from "./fileName";

describe("fileSafe (#1198)", () => {
  it("keeps accented letters and other scripts", () => {
    expect(fileSafe("Zoë Müller - Nestlé Resume")).toBe("Zoë Müller - Nestlé Resume");
    expect(fileSafe("李明 - Acme Resume")).toBe("李明 - Acme Resume");
    // A decomposed "ë" (e + combining mark) is stored composed.
    expect(fileSafe("Zoë")).toBe("Zoë");
  });
  it("drops what a file name can't carry", () => {
    expect(fileSafe('Pat Lee - Foo/Bar: "Baz" <Inc>? Resume')).toBe("Pat Lee - FooBar Baz Inc Resume");
    expect(fileSafe("Pat\nLee\u0000 - Acme, Inc. Resume")).toBe("Pat Lee - Acme Inc. Resume");
    expect(fileSafe("../../etc")).toBe("....etc");
  });
});

describe("attachment (#1198)", () => {
  it("is a plain header for an ASCII name", () => {
    expect(attachment("Alice Doe - Acme Resume.docx")).toBe('attachment; filename="Alice Doe - Acme Resume.docx"');
  });
  it("keeps the full name in filename* with an unaccented fallback", () => {
    expect(attachment("Dana Ünal - Nestlé Resume.docx")).toBe(
      "attachment; filename=\"Dana Unal - Nestle Resume.docx\"; filename*=UTF-8''Dana%20%C3%9Cnal%20-%20Nestl%C3%A9%20Resume.docx",
    );
  });
  it("never lets a quote or line break into the header", () => {
    const h = attachment('Bo "B" O\'Neil (Jr)\n.docx');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.split(";")[1]).toBe(' filename="Bo B O\'Neil (Jr).docx"');
    expect(h).toContain("filename*=UTF-8''Bo%20%22B%22%20O%27Neil%20%28Jr%29%0A.docx");
  });
});
