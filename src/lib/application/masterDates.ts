const dashes = (s: string) => s.replace(/\s*[–—-]\s*/g, "-").toLowerCase();

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
type When = { y: number; m: number | null } | "now";
// "March 2019", "Mar. 2019", "03/2019", "3/2019", "2019" or "Present", in the order they appear.
// Only real month spellings: "Marketing 2019" or "Marriott 2019" is a year, not March (#1177).
const WHEN = /\b(?:(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?,?\s+|(0?[1-9]|1[0-2])\/)?((?:19|20)\d{2})\b|\b(present|current|now|today)\b/gi;
const whens = (s: string): When[] =>
  [...s.matchAll(WHEN)].map((x) => (x[4] ? "now" : { y: +x[3], m: x[1] ? MONTHS.indexOf(x[1].slice(0, 3).toLowerCase()) + 1 : x[2] ? +x[2] : null }));
// A year-only side matches any month in that year.
const same = (a: When, b: When) => (a === "now" || b === "now" ? a === b : a.y === b.y && (a.m === null || b.m === null || a.m === b.m));
/** The line holds the same start and end, in order, however each side is written (#907). */
function sameDates(line: string, dates: string): boolean {
  const want = whens(dates);
  if (!want.length) return false;
  const have = whens(line);
  let i = 0;
  for (const h of have) if (i < want.length && same(h, want[i])) i++;
  return i === want.length;
}

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
    const together = lines.some((x) => (x.includes(d) || sameDates(x, d)) && near(x));
    if (!together) out.push(`The dates ${dates.trim()} weren't next to "${title.trim()}" in your file, so Lookout matched them by guess. Check them.`);
  }
  return out;
}
