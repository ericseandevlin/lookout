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
    // Only the title's words: the middle part is often a location, which sits on many date lines.
    // A title like "CTO" or "VP, UX" has no long word, so its short words count, matched whole (#858).
    const split = title.split(/[\s,()/&]+/).map((w) => w.toLowerCase()).filter(Boolean);
    const words = split.filter((w) => w.length > 3);
    const short = words.length ? [] : split.filter((w) => w.length > 1 && /^[a-z0-9]+$/.test(w));
    const near = (x: string) => words.some((w) => x.includes(w)) || short.some((w) => new RegExp(`\\b${w}\\b`).test(x));
    const together = lines.some((x) => x.includes(d) && near(x));
    if (!together) out.push(`The dates ${dates.trim()} weren't next to "${title.trim()}" in your file, so Lookout matched them by guess. Check them.`);
  }
  return out;
}
