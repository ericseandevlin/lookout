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
