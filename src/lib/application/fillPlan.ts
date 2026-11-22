import type { ApplicationItemKind } from "@/lib/db/schema";

/** One thing the browser worker puts into the form: an upload, a choice or typed text. */
export type FillStep = { prompt: string; required: boolean; itemKind: ApplicationItemKind; kind: "file" | "choice" | "text"; content: string; options?: string[]; file?: string };

type ItemRow = { id: string; kind: ApplicationItemKind; prompt: string; required: boolean; fieldType: string | null; options: string[] | null; approvedVersionId: string | null };

/** Approved versions only, in form order. Optional items the user didn't approve are left blank on the form. */
export function planFill(items: ItemRow[], versions: { id: string; content: string }[], opts: { skipLetter?: boolean } = {}): FillStep[] {
  const out: FillStep[] = [];
  for (const i of items) {
    // Outreach is for the person to send themselves; it is never an application-form field.
    if (i.kind === "outreach") continue;
    // A letter the published form never asked for is for email or referral use; guessing an upload put it in "Transcript" (#1210).
    if (opts.skipLetter && i.kind === "cover_letter") continue;
    const v = versions.find((x) => x.id === i.approvedVersionId);
    if (!v) continue;
    const kind: FillStep["kind"] = i.kind === "resume" || i.kind === "cover_letter" || i.fieldType === "file" ? "file" : i.options?.length ? "choice" : "text";
    out.push({ prompt: i.prompt, required: i.required, itemKind: i.kind, kind, content: v.content, ...(i.options?.length ? { options: i.options } : {}) });
  }
  return out;
}

/**
 * A file label for each upload step, unique per form (#918). Resume and cover letter keep their names; any other upload
 * ("Portfolio", "Writing sample") is named from its prompt, and a repeat gets " 2", " 3", so no upload writes over another.
 * The number rises past any label already handed out, so "Attachment", "Attachment", "Attachment 2" gives
 * "Attachment", "Attachment 2", "Attachment 2 2" rather than two "Attachment 2" (#1378). Non-file steps get null.
 */
export function uploadLabels(steps: Pick<FillStep, "kind" | "itemKind" | "prompt">[]): (string | null)[] {
  const used = new Set<string>();
  return steps.map((s) => {
    if (s.kind !== "file") return null;
    const base =
      s.itemKind === "cover_letter" ? "Cover Letter" : s.itemKind === "resume" ? "Resume" : s.prompt.replace(/[^\p{L}\p{N}\p{M}_ .-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim() || "Document";
    let label = base;
    for (let n = 2; used.has(label.toLowerCase()); n++) label = `${base} ${n}`;
    used.add(label.toLowerCase());
    return label;
  });
}

/** a starts b and ends on a word boundary there: "no" starts "no, thanks" but not "none" (#632). A blank option starts nothing (#722). */
const startsWord = (a: string, b: string) => !!a && b.startsWith(a) && (b.length === a.length || /\W/.test(b[a.length]) || /\W/.test(a[a.length - 1]));

/**
 * An option or answer as compared: a required mark ("Yes*") is not part of it (#1061), and curly quotes match straight
 * ones, so "I don't wish to answer" lands on "I don’t wish to answer" (#1255). An en or em dash, spaced or not, is a
 * hyphen: "Yes - I am authorized" lands on "Yes – I am authorized" or "Yes—I am authorized" (#1277). fill.js carries the same rule.
 */
const normChoice = (t: string) =>
  t.replace(/[*✱]/g, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s*[‐‑‒–—―-]\s*/g, " - ").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The whole text with spaces, hyphens, dashes, apostrophes and dots gone, so "Full time" is "Full-time", "Onsite" is
 * "On-site" and "Bachelors" is "Bachelor's" (#1518). Only ever compared whole, so "No" still never matches "None".
 */
// A separator between two digits stays as a mark: "1-2" is a range, never "12", and "1.5" is never "15" (#1549).
const compactChoice = (t: string) => normChoice(t).replace(/(\d)[\s'".-]+(?=\d)/g, "$1~").replace(/[\s'".-]+/g, "");

/**
 * The form option an answer names, compared whole the way the filler does: case, a required mark, curly quotes, dashes
 * and "Full time" vs "Full-time" aside. No prefix match, so "No" is never "None". The drafter and saved answers use it,
 * so an answer the filler would land isn't thrown away first (#1524).
 */
export const sameOption = (answer: string, options: string[]): string | undefined => {
  const a = normChoice(answer);
  if (!a) return undefined;
  return options.find((o) => normChoice(o) === a) ?? options.find((o) => !!compactChoice(o) && compactChoice(o) === compactChoice(answer));
};

/**
 * Which option labels to tick on a "select any that apply" question (#165). One answer per line.
 * Exact text first, then the same text spelled with or without hyphens and spaces (#1518), then a prefix match either way, so a long label cut short in the answer still lands.
 * Prefixes stop at a word boundary and the closest length wins, so "None" is "None of the above", not "No" (#632).
 */
export function pickOptions(content: string, options: string[] = []): string[] {
  const norm = normChoice;
  const out: string[] = [];
  for (const part of content.split(/\n+/).map((t) => t.trim()).filter(Boolean)) {
    const p = norm(part);
    const near = options.filter((o) => startsWord(norm(o), p) || startsWord(p, norm(o))).sort((a, b) => Math.abs(norm(a).length - p.length) - Math.abs(norm(b).length - p.length));
    const hit = options.find((o) => norm(o) === p) ?? options.find((o) => !!compactChoice(o) && compactChoice(o) === compactChoice(part)) ?? near[0];
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
  const norm = normChoice;
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
 * a failed submit (#886), even with "not yet been" between (#1154). Nor "unsuccessfully submitted" (#1115), nor "no application
 * has been submitted" (#1154). "You have submitted your application" and "You've submitted your application" count (#1452).
 * "Your application is complete" and a bare "Application complete" count, but not "make sure your application is
 * complete" or a progress label like "Application complete: 80%" (#1621). "Submission complete" and "Applied successfully!"
 * count too (#1647).
 * extension/firefox/fill.js and background.js carry the same pattern.
 */
export const CONFIRMATION = /(?<!\b(?:once|after|when|if|before|until|upon)\b[^.!?\n]{0,40})(?:thank(?:s| you) for (?:applying|your application|submitting|your submission)|(?<!\bno\s+)(?:application|submission|candidacy) (?:has been |was )?(?:successfully )?(?:received|submitted|sent)\b|application (?:for|to|with) [^.!?\n]{1,80}? (?:has been|was) (?:successfully )?(?:received|submitted|sent)\b|we(?:'ve|’ve| have)? (?:successfully )?(?:received|got) your (?:application|submission)|you(?:'ve|’ve| have) (?:successfully )?submitted your (?:application|submission)\b|(?<!(?:\bnot|\bnever|n't|n’t)\s+(?:(?:be|been|yet)\s+){0,2})\bsuccessfully (?:applied|submitted)\b|(?<!\b(?:sure|ensure|check|confirm|verify)\s+(?:that\s+)?(?:your\s+|the\s+)?)\b(?:application|submission) (?:is |has been |was )?(?:now |successfully )?completed?(?=\s*(?:[.!\n]|$))|(?<!(?:\bnot|\bnever|n't|n’t)\s+(?:(?:be|been|yet)\s+){0,2})\bapplied successfully\b)/i;

/**
 * Whether an answer reads as one for a checkbox at all: a yes, a no or nothing. A text answer ("https://linkedin.com/in/...")
 * whose own field is missing must not untick a box whose label only holds the question ("I don't have a LinkedIn profile", #1112).
 */
export function answersBox(answer: string): boolean {
  const a = answer.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return !a || checksBox(a) || /^(no|false)\b/.test(a);
}

/**
 * Whether an answer to a lone checkbox ("I agree to the privacy policy") means tick it (#669).
 * Yes, true and the consent verbs, alone or leading the answer ("Yes, I agree", "I certify the above"),
 * past tense too ("Agreed"), and "I have read and agree", "I understand" (#681), "I have read and understand", "I've read and understood" (#796),
 * "I hereby agree", "I hereby certify", a bare "Understood" and "Read and agreed" (#899).
 * "I authorize", "I attest" and "I affirm", for background-check and attestation boxes (#911).
 * Anything else, including empty, leaves the box as it is.
 */
export function checksBox(answer: string): boolean {
  const a = answer.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return /^(yes|true|(i(( have|'ve|’ve)? read| understand) and |read and |i (hereby )?)?(agreed?|acknowledged?|confirm(ed)?|consent(ed)?|certif(y|ied)|accept(ed)?|authori[sz]e[ds]?|attest(ed)?|affirm(ed)?)|(i(( have|'ve|’ve)? read and)? |read and )?underst(and|ood))\b/.test(a);
}
