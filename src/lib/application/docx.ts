import "server-only";
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TabStopType, TextRun } from "docx";
import { parseDraft } from "./resumeLayout";

/**
 * A Word file that reads as a resume a person made: name header, contact line, ruled section
 * headings, role lines with dates on the right, tight bullets. Still ATS-safe: one column, real
 * text, no tables, text boxes or images (#106).
 */

const FONT = "Calibri";
const INK = "1F1F1F";
const MUTED = "555555";
// US Letter, 0.75in side margins: right tab at the text edge (twips).
const RIGHT = 12240 - 2 * 1080;

export async function draftToDocx(md: string, title: string, opts: { letterHeader?: { name: string; contact: string } } = {}) {
  const blocks = parseDraft(md);
  const kids: Paragraph[] = [];
  const header = opts.letterHeader && blocks[0]?.t !== "name" ? opts.letterHeader : null;
  if (header) {
    kids.push(new Paragraph({ children: [new TextRun({ text: header.name, bold: true, size: 36, font: FONT, color: INK })], spacing: { after: 40 } }));
    if (header.contact) kids.push(new Paragraph({ children: [new TextRun({ text: header.contact, size: 19, font: FONT, color: MUTED })], spacing: { after: 360 } }));
  }
  for (const [i, b] of blocks.entries()) {
    const next = blocks[i + 1];
    if (b.t === "name") kids.push(new Paragraph({ children: [new TextRun({ text: b.text, bold: true, size: 40, font: FONT, color: INK })], spacing: { after: 60 } }));
    else if (b.t === "contact") kids.push(new Paragraph({ children: [new TextRun({ text: b.text, size: 19, font: FONT, color: MUTED })], spacing: { after: next?.t === "contact" ? 20 : 120 } }));
    else if (b.t === "section")
      kids.push(
        new Paragraph({
          children: [new TextRun({ text: b.text.toUpperCase(), bold: true, size: 21, font: FONT, color: INK, characterSpacing: 30 })],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 2 } },
          spacing: { before: 240, after: 100 },
          keepNext: true,
        }),
      );
    else if (b.t === "role")
      kids.push(
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: RIGHT }],
          children: [new TextRun({ text: b.text, bold: true, size: 21, font: FONT, color: INK }), ...(b.right ? [new TextRun({ text: `\t${b.right}`, size: 20, font: FONT, color: MUTED })] : [])],
          spacing: { before: 140, after: 40 },
          keepNext: true,
        }),
      );
    else if (b.t === "bullet") kids.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: b.text, size: 20, font: FONT, color: INK })], spacing: { after: 30 } }));
    else kids.push(new Paragraph({ children: [new TextRun({ text: b.text, size: 20, font: FONT, color: INK })], spacing: { after: header ? 200 : 80 }, alignment: AlignmentType.LEFT }));
  }
  const doc = new Document({
    title,
    creator: header?.name ?? (blocks[0]?.t === "name" ? blocks[0].text : ""),
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 900, bottom: 900, left: 1080, right: 1080 } } }, children: kids }],
  });
  return Packer.toBuffer(doc);
}
