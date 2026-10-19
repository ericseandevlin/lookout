/**
 * One reading of a draft's light markdown, shared by the on-screen preview and the .docx, so what
 * the user approves on screen is what the recruiter opens (#106).
 */

export type Block =
  | { t: "name"; text: string }
  | { t: "headline"; text: string }
  | { t: "contact"; text: string }
  | { t: "section"; text: string }
  | { t: "role"; text: string; right?: string }
  /** A title under an employer heading: several titles at one company, or clients under a freelance umbrella (#137). */
  | { t: "subrole"; text: string; right?: string }
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

/** A header line is contact info when it holds an email, phone, URL or domain. Anything else is the headline. */
const CONTACTISH = /@|https?:\/\/|www\.|linkedin|github|\b[\w-]+\.(com|co|io|net|org|dev|me|design|studio|ai)\b|\(?\d{3}\)?[.\s-]\d{3}[.\s-]\d{4}|\+\d/i;

export function parseDraft(md: string): Block[] {
  const out: Block[] = [];
  const header: Block[] = [];
  let seenSection = false;
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h && h[1].length === 1 && !out.length) out.push({ t: "name", text: strip(h[2]) });
    else if (h && h[1].length === 2) {
      if (!seenSection) out.push(...orderHeader(header));
      seenSection = true;
      out.push({ t: "section", text: strip(h[2]) });
    } else if (!seenSection && out[0]?.t === "name" && !h && !/^[-*•]\s+/.test(line)) header.push({ t: CONTACTISH.test(line) ? "contact" : "headline", text: strip(line) });
    else if (h && h[1].length === 4) out.push({ t: "subrole", ...splitRole(strip(h[2])) });
    else if (h) out.push({ t: "role", ...splitRole(strip(h[2])) });
    else if (/^[-*•]\s+/.test(line)) out.push({ t: "bullet", text: strip(line.replace(/^[-*•]\s+/, "")) });
    else out.push({ t: "text", text: strip(line) });
  }
  if (!seenSection) out.push(...orderHeader(header));
  return out;
}

/**
 * How a role line reads (#137): a heading followed by titles under it is an employer (plain); any
 * other role line starts with the job title, which Cool shows in the highlight color. The title is
 * the part before the first comma ("Web Development Team Lead, RPM").
 */
export function roleParts(blocks: Block[], i: number): { title: string; rest: string } {
  const b = blocks[i];
  if (b.t !== "role") return { title: "", rest: "" };
  if (blocks[i + 1]?.t === "subrole") return { title: "", rest: b.text };
  // The title ends at the company (", RPM") or the location (" | New York"), whichever comes first.
  const k = [b.text.indexOf(", "), b.text.indexOf(" | ")].filter((x) => x > 0).sort((x, y) => x - y)[0];
  return k ? { title: b.text.slice(0, k), rest: b.text.slice(k) } : { title: b.text, rest: "" };
}

/** Name, then headline, then contact: what a recruiter should read first, in that order (#129). */
const orderHeader = (h: Block[]) => {
  const head = h.filter((b) => b.t === "headline");
  const contact = h.filter((b) => b.t === "contact");
  // No headline line of its own: it may be buried at the front of the contact line. Lift it out (#129).
  if (!head.length && contact[0]?.t === "contact") {
    const { headline, rest } = liftHeadline(contact[0].text);
    if (headline) return [{ t: "headline" as const, text: headline }, ...(rest ? [{ t: "contact" as const, text: rest }] : []), ...contact.slice(1)];
  }
  return [...head, ...contact];
};

/** Words that make a header piece a job title, not a city. */
const ROLEISH = /\b(engineer\w*|design\w*|develop\w*|lead|leader|manager|director|architect|strateg\w*|consultant|scientist|analyst|head|vp|president|officer|founder|product|ux|ui|writer|researcher|specialist)\b/i;

/** Leading title pieces of a contact line ("UX Engineering Lead | New York, NY • me@x.com"), split from the rest. */
export function liftHeadline(line: string): { headline?: string; rest: string } {
  const parts = line.split(/\s+([•|·])\s+/);
  const pieces = parts.filter((_, i) => i % 2 === 0);
  let k = 0;
  while (k < pieces.length && !CONTACTISH.test(pieces[k]) && ROLEISH.test(pieces[k])) k++;
  if (!k || k === pieces.length) return { rest: line };
  return { headline: pieces.slice(0, k).join(" | "), rest: pieces.slice(k).join(" • ") };
}

export type ContactPart = { text: string; href?: string };

/** Split a contact line into its pieces and make each one a link where it is one. */
export function contactParts(line: string): ContactPart[] {
  return line
    .split(/\s+[•|·]\s+|\s{2,}/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => {
      if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(text)) return { text, href: `mailto:${text}` };
      const digits = text.replace(/[^\d+]/g, "");
      if (/^\+?[\d\s().-]{10,}$/.test(text) && digits.replace("+", "").length >= 10) return { text, href: `tel:${digits}` };
      if (/^(https?:\/\/)?(www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text)) return { text, href: /^https?:/.test(text) ? text : `https://${text}` };
      return { text };
    });
}

export const TEMPLATES = ["classic", "modern", "cool"] as const;
export type Template = (typeof TEMPLATES)[number];

/** One set of design tokens per template, used by both the on-screen preview and the .docx (#129). Single column always, so ATS can read it. */
export const TEMPLATE_STYLE: Record<
  Template,
  { label: string; css: string; docxFont: string; ink: string; muted: string; accent: string; align: "left" | "center"; nameSize: number; nameWeight: number; section: "rule" | "color" | "bar"; headlineItalic: boolean }
> = {
  classic: { label: "Classic", css: "Georgia, 'Times New Roman', serif", docxFont: "Georgia", ink: "1F1F1F", muted: "555555", accent: "1F1F1F", align: "center", nameSize: 26, nameWeight: 700, section: "rule", headlineItalic: true },
  modern: { label: "Modern", css: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif", docxFont: "Calibri", ink: "1F2933", muted: "52606D", accent: "2F4A5C", align: "left", nameSize: 28, nameWeight: 700, section: "color", headlineItalic: false },
  cool: { label: "Cool", css: "'Helvetica Neue', Helvetica, Arial, sans-serif", docxFont: "Arial", ink: "161616", muted: "5B5B5B", accent: "C2410C", align: "left", nameSize: 34, nameWeight: 800, section: "bar", headlineItalic: false },
};

// --- Highlight color (#137): the person picks Cool's accent; text in it must stay readable on white.

export const ACCENTS: [string, string][] = [
  ["Rust", "C2410C"],
  ["Crimson", "B91C1C"],
  ["Plum", "86198F"],
  ["Indigo", "4338CA"],
  ["Navy", "1E3A8A"],
  ["Teal", "0F766E"],
  ["Forest", "15803D"],
];

const lum = (hex: string) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Contrast of a color against white (WCAG). */
export const contrastOnWhite = (hex: string) => 1.05 / (lum(hex) + 0.05);

/** Darken until it reads as text on white (4.5:1), keeping the hue. */
export function readable(hex: string) {
  let h = hex.replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(h)) return "C2410C";
  for (let i = 0; i < 40 && contrastOnWhite(h) < 4.5; i++)
    h = [0, 2, 4].map((j) => Math.max(0, Math.round(parseInt(h.slice(j, j + 2), 16) * 0.92)).toString(16).padStart(2, "0")).join("").toUpperCase();
  return h;
}

/** Template tokens with the person's highlight color applied (Cool only; Classic and Modern keep theirs). */
export function styleFor(template: Template, accent?: string | null) {
  const base = TEMPLATE_STYLE[template];
  return template === "cool" && accent ? { ...base, accent: readable(accent) } : base;
}

export const isTemplate = (t: unknown): t is Template => typeof t === "string" && (TEMPLATES as readonly string[]).includes(t);

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
  const headline = b.find((x) => x.t === "headline")?.text;
  return { name, contact, ...(headline ? { headline } : {}) };
}

// --- Draft shape (#129): what a recruiter reads in 10 seconds, checked in code, not only asked of the model.

const SUMMARY = /^(summary|profile|professional summary|about)$/i;
const EXPERIENCE = /^(experience|work experience|professional experience|employment|work history)$/i;

/** Sentence ends: a period after a lowercase letter, digit, % or ), then a capital. "U.S. Bank" and "Inc." don't count. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[a-z0-9%)][.!?])(?<!\b(?:Inc|Co|Corp|Ltd|Jr|Sr|St|Mr|Ms|Dr|vs|etc)\.)\s+(?=[A-Z])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Hold a resume draft to the 10-second rules: the summary is one sentence, and Experience comes right
 * after it, so the most recent role and its dates sit in the top third. Returns what it changed.
 */
export function shapeResume(md: string): { md: string; fixed: string[] } {
  const lines = md.replace(/\r/g, "").split("\n");
  const starts = lines.flatMap((l, i) => (/^##\s+/.test(l.trim()) && !/^###/.test(l.trim()) ? [i] : []));
  if (!starts.length) return { md, fixed: [] };
  const head = lines.slice(0, starts[0]);
  const secs = starts.map((s, j) => ({ title: lines[s].trim().replace(/^##\s+/, "").replace(/\*/g, "").trim(), lines: lines.slice(s, starts[j + 1] ?? lines.length) }));
  const fixed: string[] = [];

  const sum = secs.find((x) => SUMMARY.test(x.title));
  if (sum) {
    const body = sum.lines.slice(1).map((l) => l.trim()).filter(Boolean);
    const text = body.map((l) => l.replace(/^[-*•]\s+/, "")).join(" ");
    const all = sentences(text);
    if (all.length > 1) {
      sum.lines = [sum.lines[0], all[0], ""];
      fixed.push(`Cut your summary to one sentence. Left out: "${all.slice(1).join(" ")}"`);
    }
  }

  const ex = secs.findIndex((x) => EXPERIENCE.test(x.title));
  const want = sum ? secs.indexOf(sum) + 1 : 0;
  if (ex > want) {
    const [e] = secs.splice(ex, 1);
    secs.splice(want, 0, e);
    fixed.push(`Moved Experience up${sum ? " to right after the summary" : " to the top"}, so your latest role shows in the first 10 seconds.`);
  }
  if (!fixed.length) return { md, fixed };
  const out = [...head, ...secs.flatMap((x) => x.lines)].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { md: out, fixed };
}

