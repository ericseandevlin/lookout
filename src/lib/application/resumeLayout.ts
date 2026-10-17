/**
 * One reading of a draft's light markdown, shared by the on-screen preview and the .docx, so what
 * the user approves on screen is what the recruiter opens (#106).
 */

export type Block =
  | { t: "name"; text: string }
  | { t: "contact"; text: string }
  | { t: "section"; text: string }
  | { t: "role"; text: string; right?: string }
  | { t: "bullet"; text: string }
  | { t: "text"; text: string };

const DATE = /((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(\d{1,2}\/)?\d{4}\s*(–|-|to)\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?((\d{1,2}\/)?\d{4}|present|current|now)|\b(19|20)\d{2}\b$/i;

/** Em dashes read as machine-written; people use commas, pipes and en dashes in date ranges. */
export function humanize(s: string) {
  return s
    .replace(/(\d)\s*—\s*(\d|present|current)/gi, "$1 – $2")
    .replace(/\s+—\s+/g, ", ")
    .replace(/—/g, ", ");
}

const strip = (s: string) => humanize(s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1$2").trim());

/** Split "Title, Company | City | 07/2021 – Present" into the line and its dates, which go on the right. */
export function splitRole(line: string): { text: string; right?: string } {
  const parts = line.split(/\s+\|\s+/);
  if (parts.length > 1 && DATE.test(parts[parts.length - 1])) return { text: parts.slice(0, -1).join(" | "), right: parts[parts.length - 1] };
  const m = line.match(new RegExp(`^(.*?)[,\\s]+(${DATE.source})$`, "i"));
  if (m && m[1].trim()) return { text: m[1].replace(/[,|]\s*$/, "").trim(), right: m[2].trim() };
  return { text: line };
}

export function parseDraft(md: string): Block[] {
  const out: Block[] = [];
  let seenSection = false;
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h && h[1].length === 1 && !out.length) out.push({ t: "name", text: strip(h[2]) });
    else if (h && h[1].length === 2) {
      seenSection = true;
      out.push({ t: "section", text: strip(h[2]) });
    } else if (h) out.push({ t: "role", ...splitRole(strip(h[2])) });
    else if (/^[-*•]\s+/.test(line)) out.push({ t: "bullet", text: strip(line.replace(/^[-*•]\s+/, "")) });
    else if (!seenSection && out[0]?.t === "name") out.push({ t: "contact", text: strip(line) });
    else out.push({ t: "text", text: strip(line) });
  }
  return out;
}

/** Plain text for pasting into a form's text box: the same structure, no markup. */
export function toPlain(md: string) {
  return parseDraft(md)
    .map((b) => (b.t === "section" ? `\n${b.text.toUpperCase()}` : b.t === "bullet" ? `• ${b.text}` : b.t === "role" ? `\n${b.text}${b.right ? `    ${b.right}` : ""}` : b.text))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A cover letter's header: the resume's own name and first contact line, so both files match. */
export function letterHeaderFrom(resumeMd: string | undefined, fallbackName: string) {
  const b = parseDraft(resumeMd ?? "");
  const name = b[0]?.t === "name" ? b[0].text : fallbackName;
  const contact = b.find((x) => x.t === "contact")?.text ?? "";
  return { name, contact };
}
