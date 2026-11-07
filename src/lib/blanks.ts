/**
 * Sentence starters with real blanks (#254). A template reads like
 * "Built and led a team of {n:8}[ that {t:shipped the design system}]":
 * `{n:..}` is a number blank, `{s:..}` a short text blank, `{t:..}` a longer one; the text after the
 * colon is the placeholder. A `[...]` chunk is optional and drops out when any blank in it is empty.
 * A blank outside `[...]` is required: if it is empty the sentence is not written at all, so a
 * half-filled starter never puts a bare "__" into the answer.
 */
export type BlankKind = "n" | "s" | "t";
export type Part = { text: string } | { blank: number; kind: BlankKind; placeholder: string };
export type Chunk = { optional: boolean; parts: Part[] };

const TOKEN = /\{([nst]):([^}]*)\}/g;

function parseParts(src: string, next: () => number): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    if (m.index > last) parts.push({ text: src.slice(last, m.index) });
    parts.push({ blank: next(), kind: m[1] as BlankKind, placeholder: m[2] });
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push({ text: src.slice(last) });
  return parts;
}

/** Split a template into required and optional chunks, numbering blanks in reading order. */
export function parseTemplate(template: string): Chunk[] {
  let n = 0;
  const next = () => n++;
  const chunks: Chunk[] = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0;
  for (const m of template.matchAll(re)) {
    if (m.index > last) chunks.push({ optional: false, parts: parseParts(template.slice(last, m.index), next) });
    chunks.push({ optional: true, parts: parseParts(m[1], next) });
    last = m.index + m[0].length;
  }
  if (last < template.length) chunks.push({ optional: false, parts: parseParts(template.slice(last), next) });
  return chunks;
}

export const blankCount = (chunks: Chunk[]) => chunks.reduce((c, ch) => c + ch.parts.filter((p) => "blank" in p).length, 0);

/** The finished sentence for these fills, or "" when a required blank is still empty. */
export function fillTemplate(chunks: Chunk[], fills: string[]): string {
  const val = (i: number) => (fills[i] ?? "").trim();
  let out = "";
  for (const ch of chunks) {
    const empty = ch.parts.some((p) => "blank" in p && !val(p.blank));
    if (empty && !ch.optional) return "";
    if (empty) continue;
    out += ch.parts.map((p) => ("blank" in p ? val(p.blank) : p.text)).join("");
  }
  out = out.replace(/\s+/g, " ").replace(/[\s,;:]+$/, "").trim();
  if (!out) return "";
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

