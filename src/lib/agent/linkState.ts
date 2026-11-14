/** Pure classification of a posting check, kept apart from the DB code so it's testable. */
export type LinkState = "open" | "gone" | "unknown";

/** The line Lookout adds to a find's notes when it closes the posting. */
export const closedNote = (reason: string, day: string) => `Closed: the posting was gone (${reason}) as of ${day}. Lookout archived it.`;
const CLOSED_NOTE = /^Closed: the posting was gone \(.*\) as of \d{4}-\d{2}-\d{2}\. Lookout archived it\.$/gm;

/** The same closed line for Postgres (newline-sensitive "n" flag), to drop closed-only notes inside a query (#1050). */
export const CLOSED_NOTE_SQL = CLOSED_NOTE.source;

/** A find's notes without Lookout's own closed line: what the person wrote (#792). */
export const ownNotes = (notes: string) => notes.replace(CLOSED_NOTE, "").trim();

// Phrases job boards use for a posting that's no longer live. Checked against the start of the page text only.
const CLOSED = [
  // Not "no longer open to candidates requiring sponsorship" (#903), "no longer accepting candidates from agencies" (#933),
  // or "no longer accepting applications via email; apply on this page" (#1027).
  /no longer (accepting (applications|applicants|candidates)\b(?! (from|via|by (e-?mail|mail|post|phone|fax)|through (e-?mail|mail|linkedin|indeed|recruiters?|agencies))\b)|open(?! to\b))/i,
  // "Available", "active" and "posted" need the job as the subject, or start a sentence: "Visa sponsorship is no longer
  // available for this role" is about the visa, not the job (#933).
  // Not "Visa sponsorship for this position is no longer available": there the job is the object of "for" (#980).
  // Not "the opportunity to work fully remote is no longer available": the noun leads into something else (#1007).
  /(?<!\b(?:for|of|to|on|with|in|about) (?:this |the |a |our )?)\b(job|position|posting|role|opening|requisition|listing|vacancy|opportunity|page)\b(?!\s+to\b)[^.!?\n]{0,30}?\bno longer (available|active|posted)\b/i,
  // A colon starts one only after a status label: "Visa sponsorship: No longer available" is about the visa (#1007).
  /(?:^|[.!?\n]\s*|\b(?:text|status|job status|posting status|job|posting|position|role):\s*)(?:sorry[,!]?\s*)?no longer (available|active|posted)\b/im,
  // Not "open until the position has been filled" or "once the position has been filled, this posting will be removed" (#903).
  /(?<!\b(?:(?:until|till|til)(?: such time as)?|once|when|after|if|before|unless|for|of|to|on|with|in|about) (?:the |this |a |our )?)(job|position|posting|role|requisition|opening) (is )?(no longer|has (?:already |now )?been) (available|filled|closed|removed)/i,
  /(job|posting|position|page) (was )?not found/i,
  /(?<!\b(?:until|till|til|once|when|after|if|before|unless) )this (job|position|posting|role)( ad)? (is |has )?(now )?(expired|closed|been filled)\b(?! to\b|[- ]?date\b|-)/i,
  // More wordings careers sites use (#747).
  // Not a live page's "Job Posting Expired Date: 12/31" label (#1083).
  /\b(job|posting|position|listing|vacancy|opportunity|role)( ad)? (has )?expired\b(?![- ]?date\b)/i,
  /(job|position|posting|role|page) you(['’]re| are) (looking for|trying to (apply for|access|view|reach)) (has|is|was|might have|may have) (been )?(filled|removed|closed|deleted|expired)\b/i,
  /(job|position|posting|role|opening) is not available anymore/i,
  /page you(['’]re| are) looking for (doesn['’]t|does not|no longer) exists?|(can(['’]|no)t|couldn['’]t|could not) find (that|this|the) page/i,
  // Careers sites usually render a curly apostrophe (#734).
  /(the )?(job|position) you(['’]re| are) looking for (is no longer|could not be|can(['’]|no)t be) (available|found)/i,
  /applications (for this (job|role|position) )?(are|is|have) (now )?closed/i,
  // "This job posting has closed", "This vacancy has now closed", "Job Closed", but not "closed to contractors" (#760),
  // a live page's "Position Closed Date: 11/30" label or "closed-loop" (#832).
  /\b(job|posting|position|role|vacancy|opportunity|listing)( posting| ad)? (is |has )?(now )?closed\b(?! to\b|[- ]?date\b|-)/i,
  // Not "not accepting applications at this time from third-party recruiters" (#1083).
  /not accepting applications (for this (job|role|position)|at this time)(?!,? (from|via|by|through)\b)/i,
  /\bpage not found\b|\b404\b.{0,40}(not found|doesn.t exist)/i,
];
// Pages that prove nothing either way.
// Only a maintenance page's own wording: "the creation and maintenance of our design system" is a live posting (#933).
const NOT_A_VERDICT = [
  /(down|offline|closed|unavailable) (for|due to) (scheduled |planned )?maintenance|(under|undergoing) (scheduled )?maintenance|(scheduled|planned) maintenance|maintenance (mode|window|in progress|underway)/i, /temporarily unavailable/i, /access denied|forbidden|captcha|verify you are human|enable javascript/i];

// "Till" and "'til" read the same as "until" (#1101).
// "Until such time as this position has been filled", "as soon as the role is filled": a condition about the future (#980).
// "Once the role is filled, the posting is closed" leads in a clause early, so these count anywhere in the sentence.
const CONDITION = /\b(until|till|til|as soon as|once(?! again\b)|when|whenever|if|unless)\b/i;
// "After" and "before" are mostly prepositions ("After careful consideration, this position has been filled"), so they
// count only in the clause right before the phrase (#1006).
const NEAR_CONDITION = /\b(after|before)\b/i;

const lastOf = (s: string, marks: string[]) => Math.max(...marks.map((c) => s.lastIndexOf(c)));

/** A closed phrase counts unless it is led into with a condition (#980). */
function saysClosed(r: RegExp, text: string) {
  for (const m of text.matchAll(new RegExp(r.source, r.flags.includes("g") ? r.flags : `${r.flags}g`))) {
    // A match can start on the separator before the phrase ("\nNo longer available"): look back from the phrase itself,
    // not from the line above (#1006).
    const before = text.slice(0, m.index + (/^[.!?:;\n\s]*/.exec(m[0])?.[0].length ?? 0));
    const sentence = before.slice(lastOf(before, [".", "!", "?", "\n", ";"]) + 1);
    const clause = sentence.slice(lastOf(sentence, [",", ":"]) + 1);
    if (!CONDITION.test(sentence) && !NEAR_CONDITION.test(clause)) return true;
  }
  return false;
}

export function classifyPage(status: number, text: string, finalUrl = ""): { state: LinkState; reason: string } {
  if (status === 404 || status === 410) return { state: "gone", reason: `page answered ${status}` };
  // Greenhouse sends a closed job to the company's board with ?error=true, Workable with ?not_found=true (#1099).
  if (/[?&](error|not_found)=true\b/.test(finalUrl)) return { state: "gone", reason: "the job board says it's closed" };
  if (status !== 200) return { state: "unknown", reason: `page answered ${status}` };
  const head = text.slice(0, 2500);
  // Closed wording wins: real "job not available" pages often mention maintenance or sign-in somewhere too.
  if (CLOSED.some((r) => saysClosed(r, head))) return { state: "gone", reason: "page says it's closed" };
  if (NOT_A_VERDICT.some((r) => r.test(head))) return { state: "unknown", reason: "site unavailable or blocked" };
  return { state: "open", reason: "posting is up" };
}
