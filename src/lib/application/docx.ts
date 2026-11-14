import "server-only";
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Packer, Paragraph, TabStopType, TextRun, type ParagraphChild } from "docx";
import { contactParts, parseDraft, roleParts, styleFor, type Template } from "./resumeLayout";

/**
 * A Word file that reads as a resume a person made, in the chosen template (#106, #129): name,
 * headline, linked contact line, section headings, role lines with dates on the right, tight
 * bullets. Always ATS-safe: one column, real text, no tables, text boxes or images.
 */

// US Letter, 0.75in side margins: right tab at the text edge (twips).
const RIGHT = 12240 - 2 * 1080;
const pt = (n: number) => Math.round(n * 2);

// Characters XML 1.0 forbids. Word calls a file holding one corrupt; text pasted from Word can carry \v (#1144).
const xmlSafe = (t: string) => t.replace(/[\u000b\u000c]/g, " ").replace(/[\u0000-\u0008\u000e-\u001f]/g, "");

export async function draftToDocx(md: string, title: string, opts: { letterHeader?: { name: string; contact: string; headline?: string }; template?: Template; accent?: string } = {}) {
  md = xmlSafe(md);
  title = xmlSafe(title);
  if (opts.letterHeader) {
    const h = opts.letterHeader;
    opts = { ...opts, letterHeader: { name: xmlSafe(h.name), contact: xmlSafe(h.contact), ...(h.headline !== undefined ? { headline: xmlSafe(h.headline) } : {}) } };
  }
  const T = styleFor(opts.template ?? "modern", opts.accent);
  const run = (text: string, o: { size?: number; bold?: boolean; italics?: boolean; color?: string; caps?: boolean; spacing?: number } = {}) =>
    new TextRun({ text, font: T.docxFont, size: pt(o.size ?? 10), bold: o.bold, italics: o.italics, color: o.color ?? T.ink, allCaps: o.caps, characterSpacing: o.spacing });
  const align = T.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;

  const contactLine = (line: string, after: number) => {
    const kids: ParagraphChild[] = [];
    contactParts(line).forEach((p, i) => {
      if (i) kids.push(run("  •  ", { size: 9.5, color: T.muted }));
      kids.push(p.href ? new ExternalHyperlink({ link: p.href, children: [run(p.text, { size: 9.5, color: T.accent })] }) : run(p.text, { size: 9.5, color: T.muted }));
    });
    return new Paragraph({ alignment: align, children: kids, spacing: { after } });
  };
  const name = (text: string) => new Paragraph({ alignment: align, children: [run(text, { size: T.nameSize / 1.35, bold: true })], spacing: { after: 40 } });
  const headline = (text: string) =>
    new Paragraph({ alignment: align, children: [run(text, { size: 12, color: T.section === "bar" ? T.accent : T.ink, italics: T.headlineItalic, bold: T.section === "bar" })], spacing: { after: 60 } });
  const section = (text: string) =>
    new Paragraph({
      alignment: T.section === "rule" ? align : AlignmentType.LEFT,
      children: [run(text, { size: 10.5, bold: true, caps: true, spacing: 30, color: T.section === "rule" ? T.ink : T.accent })],
      border:
        T.section === "rule"
          ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 2 } }
          : T.section === "bar"
            ? { left: { style: BorderStyle.SINGLE, size: 24, color: T.accent, space: 6 } }
            : undefined,
      spacing: { before: 260, after: 100 },
      keepNext: true,
    });

  const blocks = parseDraft(md);
  const kids: Paragraph[] = [];
  const header = opts.letterHeader && blocks[0]?.t !== "name" ? opts.letterHeader : null;
  if (header) {
    kids.push(name(header.name));
    if (header.headline) kids.push(headline(header.headline));
    if (header.contact) kids.push(contactLine(header.contact, 360));
  }
  for (const [i, b] of blocks.entries()) {
    const next = blocks[i + 1];
    if (b.t === "name") kids.push(name(b.text));
    else if (b.t === "headline") kids.push(headline(b.text));
    else if (b.t === "contact") kids.push(contactLine(b.text, next?.t === "contact" ? 20 : 140));
    else if (b.t === "section") kids.push(section(b.text));
    else if (b.t === "role")
      kids.push(
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: RIGHT }],
          children: [
            ...(T.section === "bar"
              ? (() => {
                  const r = roleParts(blocks, i);
                  return [...(r.title ? [run(r.title, { size: 10.5, bold: true, color: T.accent })] : []), ...(r.rest ? [run(r.rest, { size: 10.5, bold: true })] : [])];
                })()
              : [run(b.text, { size: 10.5, bold: true })]),
            ...(b.right ? [run(`\t${b.right}`, { color: T.muted })] : []),
          ],
          spacing: { before: 140, after: 40 },
          keepNext: true,
        }),
      );
    else if (b.t === "subrole")
      kids.push(
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: RIGHT }],
          children: [run(b.text, { size: 10.5, bold: true, italics: T.headlineItalic, color: T.section === "bar" ? T.accent : T.ink }), ...(b.right ? [run(`\t${b.right}`, { color: T.muted })] : [])],
          spacing: { before: 60, after: 30 },
          keepNext: true,
        }),
      );
    else if (b.t === "bullet") kids.push(new Paragraph({ bullet: { level: 0 }, children: [run(b.text)], spacing: { after: 30 } }));
    else kids.push(new Paragraph({ children: [run(b.text)], spacing: { after: header ? 200 : 80 } }));
  }
  const doc = new Document({
    title,
    creator: header?.name ?? (blocks[0]?.t === "name" ? blocks[0].text : ""),
    styles: { default: { document: { run: { font: T.docxFont, size: 20 } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 900, bottom: 900, left: 1080, right: 1080 } } }, children: kids }],
  });
  return Packer.toBuffer(doc);
}
