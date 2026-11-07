import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { draftToDocx } from "./docx";
import { TEMPLATES } from "./resumeLayout";

const resume = `# Sam Rivera
Product Designer
Brooklyn, NY • sam@example.com • samrivera.design

## Experience
### Lead Designer, Harbor Labs | Remote | 2021 – Present
- Ran the design system.
- Cut checkout steps from five to two.

## Education
BFA, Pratt`;

const letter = "Dear hiring team,\n\nI'd like to help Harbor Labs ship faster.\n\nThanks,\nSam";

async function open(md: string, opts: Parameters<typeof draftToDocx>[2] = {}, title = "Resume") {
  const zip = await JSZip.loadAsync(await draftToDocx(md, title, opts));
  const xml = await zip.file("word/document.xml")!.async("string");
  const core = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
  const rels = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(([p]) => ({
    xml: p,
    text: [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>/g)].map((m) => m[1] ?? "\t").join(""),
  }));
  return { xml, core, rels, paras, text: paras.map((p) => p.text) };
}

describe("draftToDocx", () => {
  it("writes every part of the resume as real text, in order", async () => {
    const { text } = await open(resume);
    expect(text[0]).toBe("Sam Rivera");
    expect(text[1]).toBe("Product Designer");
    expect(text[2]).toBe("Brooklyn, NY  •  sam@example.com  •  samrivera.design");
    expect(text).toContain("Lead Designer, Harbor Labs | Remote\t2021 – Present");
    expect(text).toContain("Ran the design system.");
    expect(text).toContain("BFA, Pratt");
    expect(text.indexOf("Experience")).toBeLessThan(text.indexOf("Education"));
  });

  it("links email and website in the contact line", async () => {
    const { rels, xml } = await open(resume);
    expect(rels).toContain('Target="mailto:sam@example.com"');
    expect(rels).toContain('Target="https://samrivera.design"');
    expect(xml.match(/<w:hyperlink /g)).toHaveLength(2);
  });

  it("makes bullets real list items, not typed dots", async () => {
    const { paras } = await open(resume);
    const bullet = paras.find((p) => p.text === "Ran the design system.")!;
    expect(bullet.xml).toContain("<w:numPr>");
    expect(bullet.text.startsWith("•")).toBe(false);
  });

  it.each(TEMPLATES)("stays ATS-safe in %s: one column, no tables, images or text boxes", async (template) => {
    const { xml } = await open(resume, { template });
    for (const tag of ["<w:tbl>", "<w:drawing", "<w:pict", "<w:txbxContent", "<w:cols w:num"]) expect(xml).not.toContain(tag);
  });

  it("uses the template's font", async () => {
    const fonts = await Promise.all(TEMPLATES.map(async (template) => (await open(resume, { template })).xml.match(/w:ascii="([^"]+)"/)?.[1]));
    expect(fonts).toEqual(["Georgia", "Calibri", "Arial"]);
  });

  it("adds the letter header above a cover letter", async () => {
    const { text } = await open(letter, { letterHeader: { name: "Sam Rivera", contact: "sam@example.com • Brooklyn, NY", headline: "Product Designer" } }, "Cover letter");
    expect(text.slice(0, 4)).toEqual(["Sam Rivera", "Product Designer", "sam@example.com  •  Brooklyn, NY", "Dear hiring team,"]);
  });

  it("skips empty header parts", async () => {
    const { text } = await open(letter, { letterHeader: { name: "Sam Rivera", contact: "" } });
    expect(text.slice(0, 2)).toEqual(["Sam Rivera", "Dear hiring team,"]);
  });

  it("doesn't add a second name when the draft already starts with one", async () => {
    const { text } = await open(resume, { letterHeader: { name: "Sam Rivera", contact: "sam@example.com" } });
    expect(text.filter((t) => t === "Sam Rivera")).toHaveLength(1);
  });

  it("sets the file's title and author", async () => {
    expect((await open(resume)).core).toMatch(/<dc:title>Resume<\/dc:title>[\s\S]*<dc:creator>Sam Rivera<\/dc:creator>|<dc:creator>Sam Rivera<\/dc:creator>[\s\S]*<dc:title>Resume<\/dc:title>/);
    const { core } = await open(letter, { letterHeader: { name: "Sam Rivera", contact: "" } }, "Cover letter");
    expect(core).toContain("<dc:title>Cover letter</dc:title>");
    expect(core).toContain("<dc:creator>Sam Rivera</dc:creator>");
  });

  it("uses US Letter with 0.75 inch side margins", async () => {
    const { xml } = await open(resume);
    expect(xml).toMatch(/<w:pgSz w:w="12240" w:h="15840"/);
    expect(xml).toMatch(/w:left="1080"/);
    expect(xml).toMatch(/w:right="1080"/);
  });
});
