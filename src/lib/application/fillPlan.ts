import type { ApplicationItemKind } from "@/lib/db/schema";

/** One thing the browser worker puts into the form: an upload, a choice or typed text. */
export type FillStep = { prompt: string; required: boolean; itemKind: ApplicationItemKind; kind: "file" | "choice" | "text"; content: string; options?: string[]; file?: string };

type ItemRow = { id: string; kind: ApplicationItemKind; prompt: string; required: boolean; fieldType: string | null; options: string[] | null; approvedVersionId: string | null };

/** Approved versions only, in form order. Optional items the user didn't approve are left blank on the form. */
export function planFill(items: ItemRow[], versions: { id: string; content: string }[]): FillStep[] {
  const out: FillStep[] = [];
  for (const i of items) {
    // Outreach is for the person to send themselves; it is never an application-form field.
    if (i.kind === "outreach") continue;
    const v = versions.find((x) => x.id === i.approvedVersionId);
    if (!v) continue;
    const kind: FillStep["kind"] = i.kind === "resume" || i.kind === "cover_letter" || i.fieldType === "file" ? "file" : i.options?.length ? "choice" : "text";
    out.push({ prompt: i.prompt, required: i.required, itemKind: i.kind, kind, content: v.content, ...(i.options?.length ? { options: i.options } : {}) });
  }
  return out;
}

/** a starts b and ends on a word boundary there: "no" starts "no, thanks" but not "none" (#632). A blank option starts nothing (#722). */
const startsWord = (a: string, b: string) => !!a && b.startsWith(a) && (b.length === a.length || /\W/.test(b[a.length]) || /\W/.test(a[a.length - 1]));

/**
 * Which option labels to tick on a "select any that apply" question (#165). One answer per line.
 * Exact text first, then a prefix match either way, so a long label cut short in the answer still lands.
 * Prefixes stop at a word boundary and the closest length wins, so "None" is "None of the above", not "No" (#632).
 */
export function pickOptions(content: string, options: string[] = []): string[] {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const out: string[] = [];
  for (const part of content.split(/\n+/).map((t) => t.trim()).filter(Boolean)) {
    const p = norm(part);
    const near = options.filter((o) => startsWord(norm(o), p) || startsWord(p, norm(o))).sort((a, b) => Math.abs(norm(a).length - p.length) - Math.abs(norm(b).length - p.length));
    const hit = options.find((o) => norm(o) === p) ?? near[0];
    const label = hit ?? (options.length ? null : part);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * The index of the one option a dropdown answer means, or -1 (#695): exact text, then the pickOptions rule, then the
 * long-label match (first 80 characters). A plain prefix put "No" on "None of the above" (#644).
 * extension/firefox/fill.js carries the same rule.
 */
export function pickOne(answer: string, labels: string[]): number {
  const norm = (t: string) => t.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const a = norm(answer);
  const exact = labels.findIndex((l) => norm(l) === a);
  if (exact >= 0) return exact;
  const [hit] = pickOptions(answer, labels);
  if (hit != null) return labels.indexOf(hit);
  const same = (x: string, y: string) => !!x && !!y && (x === y || x.startsWith(y.slice(0, 80)) || y.startsWith(x.slice(0, 80)));
  return labels.findIndex((l) => Math.min(a.length, norm(l).length) >= 80 && same(norm(l), a));
}

/**
 * The page text that means an application went through, after Submit (#692). Never a bare "thank you": forms often open
 * with "Thank you for your interest", so a submit that failed validation read as sent. A sentence that starts with once,
 * after, when, if, before, until or upon only says what happens later ("Once your application has been received, we will
 * review it"), so it never counts (#844). Nor does "not successfully submitted" or "couldn't be successfully submitted",
 * a failed submit (#886). extension/firefox/fill.js and background.js carry the same pattern.
 */
export const CONFIRMATION = /(?<!\b(?:once|after|when|if|before|until|upon)\b[^.!?\n]{0,40})(?:thank(?:s| you) for (?:applying|your application|submitting|your submission)|(?:application|submission|candidacy) (?:has been |was )?(?:successfully )?(?:received|submitted|sent)\b|application for [^.!?\n]{1,80}? (?:has been|was) (?:successfully )?(?:received|submitted|sent)\b|we(?:'ve|’ve| have)? (?:successfully )?(?:received|got) your (?:application|submission)|(?<!(?:\bnot|\bnever|n't|n’t)\s+(?:(?:be|been|yet)\s+)?)successfully (?:applied|submitted)\b)/i;

/**
 * Whether an answer to a lone checkbox ("I agree to the privacy policy") means tick it (#669).
 * Yes, true and the consent verbs, alone or leading the answer ("Yes, I agree", "I certify the above"),
 * past tense too ("Agreed"), and "I have read and agree", "I understand" (#681), "I have read and understand", "I've read and understood" (#796),
 * "I hereby agree", "I hereby certify", a bare "Understood" and "Read and agreed" (#899).
 * Anything else, including empty, leaves the box as it is.
 */
export function checksBox(answer: string): boolean {
  const a = answer.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return /^(yes|true|(i(( have|'ve|’ve)? read| understand) and |read and |i (hereby )?)?(agreed?|acknowledged?|confirm(ed)?|consent(ed)?|certif(y|ied)|accept(ed)?)|(i(( have|'ve|’ve)? read and)? |read and )?underst(and|ood))\b/.test(a);
}
