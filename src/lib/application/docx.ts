import "server-only";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

/**
 * A plain, ATS-safe Word file from a draft's light markdown: one column, real headings and bullets,
 * no tables, text boxes or images (applicant tracking systems misread those).
 */
export async function draftToDocx(md: string, title: string) {
  const runs = (line: string) =>
    line
      .split(/(\*\*[^*]+\*\*)/g)
      .filter(Boolean)
      .map((part) => (/^\*\*[^*]+\*\*$/.test(part) ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part.replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1$2"))));
  const paragraphs: Paragraph[] = [];
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length === 1 ? HeadingLevel.TITLE : h[1].length === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2;
      paragraphs.push(new Paragraph({ heading: level, children: runs(h[2]), spacing: { before: h[1].length === 1 ? 0 : 200, after: 80 } }));
    } else if (/^\s*[-*•]\s+/.test(line)) {
      paragraphs.push(new Paragraph({ bullet: { level: 0 }, children: runs(line.replace(/^\s*[-*•]\s+/, "")), spacing: { after: 40 } }));
    } else {
      paragraphs.push(new Paragraph({ children: runs(line), spacing: { after: 120 } }));
    }
  }
  const doc = new Document({
    title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children: paragraphs }],
  });
  return Packer.toBuffer(doc);
}
