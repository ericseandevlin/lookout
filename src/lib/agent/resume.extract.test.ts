import { Document, Packer, Paragraph } from "docx";
import { describe, expect, it } from "vitest";
import { extractResumeText } from "./resume";

/** A one-page PDF with each line of `lines` drawn in Helvetica, built by hand so the test needs no fixture file (#568). */
function pdf(lines: string[]) {
  const text = lines.map((l, i) => `BT /F1 12 Tf 72 ${720 - i * 16} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("extractResumeText", () => {
  it("reads the text of a PDF resume", async () => {
    const text = await extractResumeText(pdf(["Pat Lee", "Design Director, Acme (2019-2024)", "Grew the team from 3 to 20."]), "application/pdf");
    expect(text).toContain("Pat Lee");
    expect(text).toContain("Design Director, Acme (2019-2024)");
    expect(text).toContain("Grew the team from 3 to 20.");
  });

  it("returns no text for a PDF with nothing to read, like a scan", async () => {
    expect((await extractResumeText(pdf([]), "application/pdf")).trim()).toBe("");
  });

  it("rejects a file that claims to be a PDF but isn't", async () => {
    await expect(extractResumeText(Buffer.from("not a pdf"), "application/pdf")).rejects.toThrow();
  });

  it("reads the text of a .docx resume", async () => {
    const doc = new Document({ sections: [{ children: [new Paragraph("Pat Lee"), new Paragraph("Grew the team from 3 to 20.")] }] });
    const text = await extractResumeText(await Packer.toBuffer(doc), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(text).toContain("Pat Lee");
    expect(text).toContain("Grew the team from 3 to 20.");
  });
});
