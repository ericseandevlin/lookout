const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Add a step-up phrase after "Step up:" at the end of the answer, or take it out again. */
export function togglePhrase(value: string, phrase: string) {
  // nosemgrep -- the pattern is a fixed, escaped starter phrase (escapeRe), not user-controlled regex
  const re = new RegExp(`(;\\s*|\\s*Step up:\\s*)?${escapeRe(phrase)}`, "i");
  if (re.test(value)) {
    return value
      .replace(re, (_m, sep) => (sep && /Step up/i.test(sep) ? " Step up: " : ""))
      .replace(/Step up:\s*;\s*/i, "Step up: ")
      .replace(/\s*Step up:\s*$/i, "")
      .trim();
  }
  const v = value.trim();
  if (!v) return `Step up: ${phrase}`;
  return /Step up:/i.test(v) ? `${v.replace(/[.;,\s]+$/, "")}; ${phrase}` : `${v.replace(/[.\s]+$/, "")}. Step up: ${phrase}`;
}

/**
 * Add a common answer to a comma list, or take it out (2026-11-27 walkthrough). Common answers start with a capital
 * ("No agencies"), so one after the first is lowercased: "No agencies, no contract roles", not "No agencies, No
 * contract roles". Matching ignores case. Only items that are one of the common answers change case; typed ones
 * ("Amazon") stay as written.
 */
export function toggleItem(items: string[], item: string, common: string[]) {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const next = items.some((x) => same(x, item)) ? items.filter((x) => !same(x, item)) : [...items, item];
  return next
    .map((x, i) => {
      const c = common.find((o) => same(o, x));
      if (!c) return x;
      return i === 0 ? c : c.charAt(0).toLowerCase() + c.slice(1);
    })
    .join(", ");
}
