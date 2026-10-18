/**
 * Version notes are stored as bullet lines ("- point", "  - sub-point") so the review screen can
 * show them as lists, not walls of text. Older notes are plain sentences; those split by sentence.
 */

export type NotePoint = { text: string; sub: string[] };

export const bullets = (points: (string | { text: string; sub: string[] } | false | null | undefined)[]) =>
  points
    .filter((p): p is string | { text: string; sub: string[] } => !!p)
    .map((p) => (typeof p === "string" ? `- ${p.trim()}` : [`- ${p.text.trim()}`, ...p.sub.map((s) => `  - ${s.trim()}`)].join("\n")))
    .join("\n");

/** Sentence split that leaves "e.g.", decimals and initials alone. */
const sentences = (s: string) =>
  s
    .replace(/\b(e\.g|i\.e|etc|vs|Mr|Ms|Dr)\./g, "$1\u0000")
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((x) => x.replace(/\u0000/g, ".").trim())
    .filter(Boolean);

export function parseNote(note: string): NotePoint[] {
  const t = note.trim();
  if (!t) return [];
  if (/^- /m.test(t)) {
    const out: NotePoint[] = [];
    for (const line of t.split("\n")) {
      if (/^\s{2,}- /.test(line) && out.length) out[out.length - 1].sub.push(line.replace(/^\s+- /, "").trim());
      else if (line.trim()) out.push({ text: line.replace(/^- /, "").trim(), sub: [] });
    }
    return out;
  }
  // Older notes: one point per sentence; an "Added: a (x), b (y)." sentence becomes a sub-list.
  return sentences(t).map((s) => {
    const m = s.match(/^Added: (.+?)\.?$/);
    if (!m) return { text: s, sub: [] };
    return { text: "Added:", sub: m[1].split(/,\s+(?![^()]*\))/).map((x) => x.trim()) };
  });
}
