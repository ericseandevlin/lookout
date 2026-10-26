import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { docBlocks, docBody } from "./docHtml";
import { draftToDocx } from "./docx";
import { parseDraft, TEMPLATES } from "./resumeLayout";

// The files a recruiter opens must say what the review screen says, in the same order (#106).
const resume = `# Maya Ortiz
Design Systems Lead
New York, NY • maya@example.com • linkedin.com/in/maya

## Summary
Builds design systems that ship across a firm.

## Experience
### Acme | New York, NY | 01/2019 – Present
#### Design Systems Lead | 07/2021 – Present
- Built the component library used by 40 teams.
#### Senior Developer | 01/2019 – 06/2021
- Led the web team of five.
### Front-End Developer, Studio | 2016 – 2018
- Shipped fast marketing sites.

## Skills
React, TypeScript, Figma

## Education
BFA, Parsons`;

const letter = `Dear Acme Hiring Team,

I lead design systems at Acme, where our component library serves 40 teams.

Last year I moved the firm's apps onto shared tokens, and I'd bring that to your platform team.

I'd start with an audit of your components.

Sincerely,
Maya Ortiz`;

const header = { name: "Maya Ortiz", contact: "New York, NY • maya@example.com", headline: "Design Systems Lead" };
const sections = parseDraft(resume).filter((b) => b.t === "section").map((b) => b.text);

describe("the .docx", () => {
  it("makes each section a real Heading 1, in order, and nothing else", async () => {
    for (const template of TEMPLATES) {
      const zip = await JSZip.loadAsync(await draftToDocx(resume, "Resume", { template }));
      const xml = await zip.file("word/document.xml")!.async("string");
      const heads = [...xml.matchAll(/<w:p>(?:(?!<\/w:p>)[\s\S])*?<w:pStyle w:val="Heading1"\/>[\s\S]*?<\/w:p>/g)].map(([p]) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
      expect(heads).toEqual(sections);
      // ATS-safe: no tables, text boxes, drawings.
      expect(xml).not.toMatch(/<w:tbl>|<w:txbxContent|<w:drawing|<v:shape/);
    }
  });

  it("names the person as author, never a placeholder", async () => {
    const zip = await JSZip.loadAsync(await draftToDocx(resume, "Maya Ortiz - Acme Resume", { template: "modern" }));
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("<dc:creator>Maya Ortiz</dc:creator>");
    expect(core).toContain("<cp:lastModifiedBy>Maya Ortiz</cp:lastModifiedBy>");
    expect(core).not.toMatch(/Un-named|Lookout|AI/);
  });
});

describe("the on-screen and PDF renderer", () => {
  it("puts the name in an h1 and each section in an h2, in the draft's order", () => {
    const html = docBody(resume, { template: "cool" });
    expect([...html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1])).toEqual(["Maya Ortiz"]);
    expect([...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1])).toEqual(sections);
  });

  it("escapes text and only links real addresses", () => {
    const html = docBody("# A <b>x</b>\nme@x.com • javascript:alert(1)\n## Summary\n<script>1</script>", { template: "modern" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('href="mailto:me@x.com"');
  });

  it("puts the resume's header above a cover letter", () => {
    expect(docBlocks(letter, header).slice(0, 4).map((b) => b.t)).toEqual(["name", "headline", "contact", "text"]);
  });
});

/** A Chromium to print with: the app's, CI's Chrome, or a local Playwright download. */
function findChromium() {
  const pw = path.join(os.homedir(), ".cache/ms-playwright");
  const local = existsSync(pw)
    ? readdirSync(pw)
        .filter((d) => d.startsWith("chromium"))
        .flatMap((d) => [path.join(pw, d, "chrome-headless-shell-linux64/chrome-headless-shell"), path.join(pw, d, "chrome-linux64/chrome"), path.join(pw, d, "chrome-linux/chrome")])
    : [];
  return [process.env.CHROMIUM_PATH, "/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome", ...local].find((p) => p && existsSync(p));
}

const chrome = findChromium();

describe.skipIf(!chrome)("the PDF", () => {
  const print = async (md: string, o: Parameters<typeof docBody>[1]) => {
    process.env.CHROMIUM_PATH = chrome;
    const { draftToPdf } = await import("./pdf");
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await draftToPdf(md, { ...o, title: "Test" })));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return { text: text.replace(/\s+/g, " "), pages: totalPages };
  };

  it("reads back as real text with the same headings in the same order as the screen", async () => {
    for (const template of TEMPLATES) {
      const { text } = await print(resume, { template });
      expect(text.startsWith("Maya Ortiz")).toBe(true);
      // Headings print in uppercase (CSS), so compare without case.
      const at = sections.map((s) => text.toLowerCase().indexOf(s.toLowerCase()));
      expect(at.every((x) => x >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(text).toContain("Built the component library used by 40 teams.");
      expect(text).toContain("07/2021 – Present");
    }
  }, 60_000);

  it("prints a cover letter on one page, header first, then greeting, body and close", async () => {
    const { text, pages } = await print(letter, { template: "classic", header });
    expect(pages).toBe(1);
    const order = ["Maya Ortiz", "maya@example.com", "Dear Acme Hiring Team,", "I lead design systems", "Sincerely,"].map((s) => text.indexOf(s));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  }, 60_000);
});
