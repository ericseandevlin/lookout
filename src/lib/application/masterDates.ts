const dashes = (s: string) => s.replace(/\s*[–—-]\s*/g, "-").toLowerCase();

/**
 * Dates the rebuild attached to a job without the file putting them on the same line as that job's
 * name. PDF text floats dates loose, so those pairings are guesses: say so, in code (#131).
 */
export function looseDates(md: string, source: string): string[] {
  const lines = source.split("\n").map(dashes);
  const out: string[] = [];
  for (const l of md.split("\n")) {
    const m = l.match(/^###\s+(.+?)\s*\|.*\|\s*([^|]*\d{4}[^|]*)$/) ?? l.match(/^###\s+(.+?)\s*\|\s*([^|]*\d{4}[^|]*)$/);
    if (!m) continue;
    const [, title, dates] = m;
    const d = dashes(dates.trim());
    const words = title.split(/[\s,()]+/).filter((w) => w.length > 3).map((w) => w.toLowerCase());
    const together = lines.some((x) => x.includes(d) && words.some((w) => x.includes(w)));
    if (!together) out.push(`The dates ${dates.trim()} weren't next to "${title.trim()}" in your file, so Lookout matched them by guess. Check them.`);
  }
  return out;
}
