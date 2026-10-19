import type { MasterResume } from "@/lib/db/schema";
import { humanize, splitRole } from "./resumeLayout";
import { looseDates } from "./masterDates";

/**
 * Code-held checks on the master resume rebuild (#131). The model decides where each bullet goes;
 * this checks that against the file itself, so a misplaced bullet can't reach a draft.
 *
 * PDF text keeps each job's lines together but can put its heading before or after its bullets
 * (two-column layouts put it after). Which one holds for the whole file shows in where most bullets
 * sit next to their own job's heading. A bullet that breaks that pattern goes to the job the pattern
 * gives it; a line from the file the rebuild dropped goes to Unplaced. Both are listed to check.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** "Team Expansion: Grew the team" → "Grew the team". The rebuild may drop such labels. */
const unlabel = (s: string) => s.replace(/^\s*[A-Z][\w&/'-]*(\s+[\w&/'-]+){0,3}:\s+/, "");
const BULLET = /^\s*[•●▪◦‣*-]\s+/;
const KEY = 40;

/** The file's text as one normalized string, with where each line starts in it. */
function index(source: string) {
  const lines = source.replace(/\r/g, "").split("\n");
  const starts: number[] = [];
  let all = "";
  for (const l of lines) {
    starts.push(all.length);
    all += `${norm(l.replace(BULLET, ""))} `;
  }
  /** The line where `text` starts, if it occurs exactly once in the file. */
  const lineOf = (text: string, len = KEY, min = 12) => {
    const key = norm(text).slice(0, len).trim();
    if (key.length < min) return -1;
    const at = all.indexOf(key);
    if (at < 0 || all.indexOf(key, at + 1) >= 0) return -1;
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= at) i++;
    return i;
  };
  return { lines, lineOf };
}

type Role = { line: number; level: 3 | 4; name: string; parent?: number; anchor: number };
type Bul = { line: number; role: number; text: string; src: number };

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 57).trimEnd()}…` : s);

export function finishMaster(raw: string, source: string): { md: string; uncertain: string[] } {
  const md = humanize(raw.trim());
  const { lines: src, lineOf } = index(source);
  const lines = md.split("\n");
  const roles: Role[] = [];
  const buls: Bul[] = [];
  let cur = -1;
  let group: number | undefined;
  lines.forEach((l, i) => {
    const h = l.match(/^(#{2,4})\s+(.*)$/);
    if (h?.[1].length === 2) {
      cur = -1;
      group = undefined;
    } else if (h) {
      const level = h[1].length as 3 | 4;
      const name = splitRole(h[2]).text.split(/\s+\|\s+/)[0].trim();
      const anchor = [name, name.split(",")[0]].map((n) => lineOf(n, 200, 5)).find((a) => a >= 0) ?? -1;
      roles.push({ line: i, level, name, anchor, parent: level === 4 ? group : undefined });
      cur = roles.length - 1;
      if (level === 3) group = cur;
    } else if (BULLET.test(l) && cur >= 0) {
      const text = l.replace(BULLET, "").trim();
      buls.push({ line: i, role: cur, text, src: lineOf(unlabel(text)) });
    }
  });

  const uncertain = looseDates(raw, source);
  const moveTo = new Map<number, number | "unplaced">();
  const known = buls.filter((b) => b.src >= 0 && roles[b.role].anchor >= 0);
  const before = known.filter((b) => b.src < roles[b.role].anchor).length;
  const after = known.length - before;
  const pattern = known.length < 3 ? null : before >= known.length * 0.75 ? "before" : after >= known.length * 0.75 ? "after" : null;
  if (pattern) {
    const anchored = roles.map((r, i) => ({ ...r, i })).filter((r) => r.anchor >= 0).sort((a, b) => a.anchor - b.anchor);
    const related = (a: number, b: number) => a === b || roles[a].parent === b || roles[b].parent === a;
    for (const b of known) {
      // Heading after the bullets: the bullet belongs to the next heading in the file. Before: the last one above it.
      const want = pattern === "before" ? anchored.find((r) => r.anchor > b.src) : anchored.filter((r) => r.anchor < b.src).at(-1);
      if (want && related(want.i, b.role)) continue;
      moveTo.set(b.line, want ? want.i : "unplaced");
      uncertain.push(want ? `Lookout moved "${short(b.text)}" under ${want.name}: in your file it sits with that job's lines, not ${roles[b.role].name}. Check it.` : `"${short(b.text)}" didn't sit with any job in your file, so it's under Unplaced.`);
    }
  }

  // Lines from the file's bullets the rebuild left out: never dropped silently.
  const have = norm(lines.map(unlabel).join(" "));
  const dropped: string[] = [];
  src.forEach((l, i) => {
    if (!BULLET.test(l)) return;
    let text = l.replace(BULLET, "").trim();
    for (let j = i + 1; j < src.length && /^\s*[a-z(]/.test(src[j]); j++) text += ` ${src[j].trim()}`;
    if (text.split(/\s+/).length < 4) return;
    if (!have.includes(norm(unlabel(text)).slice(0, KEY).trim())) dropped.push(humanize(text));
  });
  if (dropped.length) uncertain.push(`${dropped.length === 1 ? "One line" : `${dropped.length} lines`} from your file didn't make it into the rebuild; ${dropped.length === 1 ? "it's" : "they're"} under Unplaced.`);

  if (!moveTo.size && !dropped.length) return { md, uncertain };
  // Rebuild the text: moved bullets join the end of their new job's bullets.
  const extra = new Map<number, string[]>();
  const unplaced: string[] = [];
  for (const b of buls) {
    const to = moveTo.get(b.line);
    if (to === undefined) continue;
    if (to === "unplaced") unplaced.push(b.text);
    else extra.set(to, [...(extra.get(to) ?? []), b.text]);
  }
  unplaced.push(...dropped);
  const endOf = (r: number) => {
    let e = roles[r].line;
    for (let i = roles[r].line + 1; i < lines.length && !/^#{2,4}\s/.test(lines[i]); i++) if (lines[i].trim()) e = i;
    return e;
  };
  const insertAfter = new Map<number, string[]>();
  for (const [r, add] of extra) insertAfter.set(endOf(r), add);
  const out: string[] = [];
  let unplacedAt = -1;
  lines.forEach((l, i) => {
    if (!moveTo.has(i)) out.push(l);
    if (/^##\s+Unplaced/i.test(l)) unplacedAt = out.length;
    for (const t of insertAfter.get(i) ?? []) out.push(`- ${t}`);
  });
  if (unplaced.length) {
    const add = unplaced.map((t) => `- ${t}`);
    if (unplacedAt >= 0) out.splice(unplacedAt, 0, ...add);
    else out.push("", "## Unplaced", ...add);
  }
  return { md: out.join("\n"), uncertain };
}

/** The bullets under "## Unplaced", for Materials to flag. */
export function unplacedLines(md: string): string[] {
  const m = md.split(/^##\s+Unplaced[^\n]*$/im)[1];
  if (!m) return [];
  return m.split(/^##\s/m)[0].split("\n").filter((l) => BULLET.test(l)).map((l) => l.replace(BULLET, "").trim());
}

/**
 * The version drafts read: the one the person confirmed. Masters fixed by hand before confirming
 * existed count as confirmed. With nothing confirmed yet, drafts use the rebuild as it stands.
 */
export function confirmedMaster(m: MasterResume | null | undefined): MasterResume["confirmed"] | undefined {
  if (!m) return undefined;
  return m.confirmed ?? (m.edited ? { md: m.md, at: m.at, fromHash: m.fromHash } : undefined);
}

/** Lines under "## Unplaced" have no job yet, so drafts leave them out until the person places them. */
export const withoutUnplaced = (md: string) => md.replace(/\n*^##\s+Unplaced[^\n]*\n[\s\S]*?(?=^##\s|(?![\s\S]))/im, "\n").trimEnd();

export const masterForDrafts = (m: MasterResume | null | undefined) => {
  const md = confirmedMaster(m)?.md ?? m?.md;
  return md ? withoutUnplaced(md) : null;
};

const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 2));
const COMMON = new Set(["and", "the", "for", "with", "senior", "lead", "manager", "director", "developer", "designer", "engineer", "engineering", "vice", "president", "new", "york", "remote"]);

/** Each bullet with the heading (and employer heading) it sits under. */
function bulletsWithRoles(md: string) {
  const out: { text: string; role: string }[] = [];
  let role = "";
  let group = "";
  for (const l of md.split("\n")) {
    const h = l.match(/^(#{2,4})\s+(.*)$/);
    if (h) {
      const name = splitRole(h[2]).text.split(/\s+\|\s+/)[0].trim();
      if (h[1].length === 2) role = group = "";
      else if (h[1].length === 3) role = group = name;
      else role = group ? `${name}, ${group}` : name;
    } else if (BULLET.test(l) && role) out.push({ text: l.replace(BULLET, "").trim(), role });
  }
  return out;
}

/**
 * Bullets a draft moved to a different job than the confirmed master gives them (#131). Drafts
 * reword bullets, so a draft bullet matches the master bullet it shares most words with.
 */
export function roleSwaps(master: string, draft: string): string[] {
  const mine = bulletsWithRoles(master).map((b) => ({ ...b, w: words(b.text) }));
  const out: string[] = [];
  for (const d of bulletsWithRoles(draft)) {
    const dw = words(d.text);
    let best: (typeof mine)[number] | undefined;
    let score = 0;
    for (const m of mine) {
      const both = [...dw].filter((w) => m.w.has(w)).length;
      const s = both / (dw.size + m.w.size - both || 1);
      if (s > score) [best, score] = [m, s];
    }
    if (!best || score < 0.5) continue;
    const here = [...words(d.role)].filter((w) => !COMMON.has(w));
    const there = words(best.role);
    if (here.length && !here.some((w) => there.has(w))) out.push(`"${short(d.text)}" is under ${d.role} here, but under ${best.role} in your master resume. Check it.`);
  }
  return out;
}
