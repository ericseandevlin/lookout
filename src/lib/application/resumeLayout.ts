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
    .map((b) => (b.t === "section" ? `\n${b.text.toUpperCase()}` : b.t === "bullet" ? `• ${b.text}` : b.t === "role" ? `\n${b.text}${b.right ? `    ${b.right}` : ""}` : b.t === "subrole" ? `${b.text}${b.right ? `    ${b.right}` : ""}` : b.text))
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

// "Executive Summary", "Career Profile", "Summary of Qualifications" too: a missed heading put Experience above the summary (#767).
export const SUMMARY_HEADING = /^(?:(?:professional|executive|career|personal|qualifications)\s+)?(?:summary|profile)(?:\s+summary)?(?:\s+of\s+qualifications)?$|^about(?:\s+me)?$/i;
const EXPERIENCE = /^(experience|work experience|professional experience|employment|work history)$/i;

/**
 * Sentence ends: a period after a lowercase letter, digit, % or ), then a capital. "U.S. Bank" and "Inc." don't count,
 * and neither do "e.g. React" or "i.e. Vue" (#890).
 */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[a-z0-9%)][.!?])(?<!\b(?:Inc|Co|Corp|Ltd|Jr|Sr|St|Mr|Ms|Dr|vs|etc|[eE]\.g|[iI]\.e)\.)\s+(?=[A-Z])/)
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

  const sum = secs.find((x) => SUMMARY_HEADING.test(x.title));
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
  fixed.push(...shapeExperience(secs));
  if (!fixed.length) return { md, fixed };
  const out = [...head, ...secs.flatMap((x) => x.lines)].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { md: out, fixed };
}


// --- Experience shape (#137), held in code like the 10-second rules: one heading per employer with
// its titles under it, one freelance umbrella with the clients named, agency contracts written
// "Title (contract via Agency), Brand", and side work that overlaps another job under Selected Projects.

type Kid = { head: string; body: string[] };
type Entry = { head: string; body: string[]; kids: Kid[] };
type Span = { s: number; e: number; from: string; to: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FREELANCE = /\b(freelance|self-employed|independent contractor)\b/i;
const PROJECTS = /^(selected )?projects$/i;

/** A month count for one side of a date range; Present is open-ended. */
function when(s: string, end: boolean): number | null {
  if (/present|current|now/i.test(s)) return Infinity;
  const y = s.match(/(19|20)\d{2}/);
  if (!y) return null;
  const mm = s.match(/\b(\d{1,2})\//);
  const mon = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  const m = mm ? +mm[1] : mon ? MONTHS.indexOf(mon[1].toLowerCase()) + 1 : end ? 12 : 1;
  return +y[0] * 12 + m;
}

function span(right?: string): Span | null {
  if (!right) return null;
  const [from, to = from] = right.split(/\s*[–-]\s*|\s+to\s+/i);
  const s = when(from, false);
  const e = when(to, true);
  return s === null || e === null ? null : { s, e, from: from.trim(), to: to.trim() };
}

/** "Title, Agency (client: Brand)" and "Title, Brand (via Agency)" read as "Title (contract via Agency), Brand". */
export function agencyWording(line: string): string {
  if (/\(contract via /i.test(line)) return line;
  const client = line.match(/^(.+?),\s*(.+?)\s*\((?:client|for|at|on assignment (?:to|at))\s*:?\s*(.+?)\)$/i);
  if (client) return `${client[1]} (contract via ${client[2]}), ${client[3]}`;
  const via = line.match(/^(.+?),\s*(.+?)\s*\((?:contract(?:ed)?\s+)?(?:via|through)\s+(.+?)\)$/i);
  if (via) return `${via[1]} (contract via ${via[3]}), ${via[2]}`;
  return line;
}

/** Title, company and city of a single role line ("Title, Company | City | dates"). */
function roleOf(head: string) {
  const { text, right } = splitRole(head.replace(/^#{3,4}\s+/, "").trim());
  const [first, ...rest] = text.split(/\s+\|\s+/);
  const k = first.indexOf(", ");
  return { first, title: k > 0 ? first.slice(0, k) : first, company: k > 0 ? first.slice(k + 2) : "", city: rest.join(" | "), right };
}

const keyOf = (company: string) =>
  company
    .toLowerCase()
    .replace(/[,.]?\s*\b(inc|llc|ltd|corp|co)\.?$/, "")
    .replace(/[^a-z0-9]/g, "");

const entrySpan = (e: Entry): Span | null => {
  const all = (e.kids.length ? e.kids.map((k) => roleOf(k.head).right) : [roleOf(e.head).right]).map(span);
  if (!all.length || all.some((x) => !x)) return span(roleOf(e.head).right);
  const s = all.reduce((a, b) => (b!.s < a!.s ? b : a))!;
  const t = all.reduce((a, b) => (b!.e > a!.e ? b : a))!;
  return { s: s.s, e: t.e, from: s.from, to: t.to };
};

const byLatest = <T>(xs: T[], at: (x: T) => Span | null) => {
  const spans = xs.map(at);
  if (spans.some((x) => !x)) return xs;
  return xs.map((x, i) => ({ x, sp: spans[i]! })).sort((a, b) => b.sp.e - a.sp.e || b.sp.s - a.sp.s).map((p) => p.x);
};

function shapeExperience(secs: { title: string; lines: string[] }[]): string[] {
  const ex = secs.find((x) => EXPERIENCE.test(x.title));
  if (!ex) return [];
  const fixed: string[] = [];

  const pre: string[] = [];
  const entries: Entry[] = [];
  for (const l of ex.lines.slice(1)) {
    const t = l.trim();
    if (/^###\s+/.test(t) && !/^####/.test(t)) entries.push({ head: t, body: [], kids: [] });
    else if (/^####\s+/.test(t) && entries.length) entries[entries.length - 1].kids.push({ head: t, body: [] });
    else if (!entries.length) pre.push(l);
    else if (t) {
      const e = entries[entries.length - 1];
      (e.kids.length ? e.kids[e.kids.length - 1].body : e.body).push(l);
    }
  }
  if (!entries.length) return [];

  // Agency contracts, the way recruiters read them.
  for (const e of entries)
    for (const k of [e, ...e.kids]) {
      const r = roleOf(k.head);
      const w = agencyWording(r.first);
      if (w !== r.first) {
        k.head = k.head.replace(r.first, w);
        fixed.push(`Wrote your agency contract as "${w}".`);
      }
    }

  // One heading per employer: several titles at one company show a promotion, not three jobs.
  let out: Entry[] = [];
  const buckets = new Map<string, Entry[]>();
  entries.forEach((e, i) => {
    const r = roleOf(e.head);
    const key = FREELANCE.test(e.head) ? "" : e.kids.length ? keyOf(r.first) : r.company ? keyOf(r.company) : "";
    const k = key || `#${i}`;
    buckets.set(k, [...(buckets.get(k) ?? []), e]);
  });
  const groups = [...buckets.values()].flatMap((g) => stints(g, entries));
  // Each group sits where its first entry was, so a split stint doesn't read as a reorder.
  groups.sort((a, b) => Math.min(...a.map((e) => entries.indexOf(e))) - Math.min(...b.map((e) => entries.indexOf(e))));
  for (const group of groups) {
    out.push(group.length > 1 ? merge(group, false) : group[0]);
    if (group.length > 1) fixed.push(`Put your ${countKids(group)} titles at ${roleOf(out[out.length - 1].head).first} under one heading, newest first.`);
  }

  // Titles under each employer, newest first.
  for (const e of out) {
    const sorted = byLatest(e.kids, (k) => span(roleOf(k.head).right));
    if (sorted.some((k, i) => k !== e.kids[i])) {
      e.kids = sorted;
      fixed.push(`Listed the titles at ${roleOf(e.head).first} newest first.`);
    }
  }

  // Side work that sits inside another job's dates is a project, not a second employer.
  const spanOf = (e: Entry) => entrySpan(e);
  const side = out.filter((e) => {
    const a = spanOf(e);
    return a && out.some((o) => {
      const b = spanOf(o);
      return o !== e && b && b.s <= a.s && a.e <= b.e && (b.s < a.s || a.e < b.e);
    });
  });
  if (side.length) {
    out = out.filter((e) => !side.includes(e));
    let proj = secs.find((x) => PROJECTS.test(x.title));
    if (!proj) secs.splice(secs.indexOf(ex) + 1, 0, (proj = { title: "Selected Projects", lines: ["## Selected Projects"] }));
    proj.lines = [...proj.lines.filter((l, i) => i === 0 || l.trim()), ...side.flatMap(lines), ""];
    for (const e of side) fixed.push(`Moved ${roleOf(e.head).first} to Selected Projects: it overlaps a job you held at the same time.`);
  }

  // Newest first, then one freelance umbrella for each run of freelance gigs next to each other.
  const ordered = byLatest(out, spanOf);
  if (ordered.some((e, i) => e !== out[i])) fixed.push("Put Experience newest first.");
  const final: Entry[] = [];
  for (let i = 0; i < ordered.length; ) {
    let j = i;
    while (j < ordered.length && FREELANCE.test(ordered[j].head) && !ordered[j].kids.length) j++;
    if (j - i > 1) {
      final.push(merge(ordered.slice(i, j), true));
      fixed.push("Put your freelance work under one Freelance heading with the clients named.");
      i = j;
    } else final.push(ordered[i++]);
  }
  if (fixed.length) ex.lines = [ex.lines[0], ...pre.filter((l) => l.trim()), ...final.flatMap(lines), ""];
  return fixed;
}

/**
 * One employer's entries split into stints wherever a job at another employer sits between them (#896). Merged, they
 * read as unbroken tenure, and the job in the gap then looked like side work inside it and moved to Selected Projects.
 */
function stints(group: Entry[], all: Entry[]): Entry[][] {
  if (group.length < 2) return [group];
  const spans = group.map(entrySpan);
  if (spans.some((x) => !x)) return [group];
  const sorted = group.map((e, i) => ({ e, sp: spans[i]! })).sort((a, b) => a.sp.s - b.sp.s);
  const others = all.filter((o) => !group.includes(o)).map(entrySpan).filter((x): x is Span => !!x);
  const runs: Entry[][] = [[sorted[0].e]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].sp;
    const next = sorted[i].sp;
    // A month of overlap at either end still counts as between: people often start the next job the month they leave.
    const between = others.some((o) => o.s >= prev.e - 1 && o.e <= next.s + 1 && o.s <= o.e);
    if (between) runs.push([sorted[i].e]);
    else runs[runs.length - 1].push(sorted[i].e);
  }
  return runs;
}

const countKids = (group: Entry[]) => group.reduce((n, e) => n + (e.kids.length || 1), 0);

/** Several entries as one heading with each title (or each freelance client) under it, newest first. */
function merge(group: Entry[], free: boolean): Entry {
  const lead = group.find((e) => e.kids.length);
  const r0 = roleOf((lead ?? group[0]).head);
  const name = free ? "Freelance" : lead ? r0.first : r0.company;
  const city = group.map((e) => roleOf(e.head).city).find(Boolean) ?? "";
  const kids = group.flatMap((e) => {
    if (e.kids.length) return e.kids;
    const r = roleOf(e.head);
    const title = free ? r.first.replace(/^freelance\s+/i, "").replace(/\s*\(freelance\)/i, "").replace(/,\s*freelance$/i, "") : r.title;
    return [{ head: `#### ${title}${r.right ? ` | ${r.right}` : ""}`, body: e.body }];
  });
  const merged: Entry = { head: "", body: group.flatMap((e) => (e.kids.length ? e.body : [])), kids: byLatest(kids, (k) => span(roleOf(k.head).right)) };
  const sp = entrySpan(merged);
  merged.head = `### ${name}${city ? ` | ${city}` : ""}${sp ? ` | ${sp.from} – ${sp.to}` : ""}`;
  return merged;
}

const lines = (e: Entry) => [e.head, ...e.body, ...e.kids.flatMap((k) => [k.head, ...k.body])];
