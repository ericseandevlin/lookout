/** Pure classification of a posting check, kept apart from the DB code so it's testable. */
export type LinkState = "open" | "gone" | "unknown";

/** The line Lookout adds to a find's notes when it closes the posting. */
export const closedNote = (reason: string, day: string) => `Closed: the posting was gone (${reason}) as of ${day}. Lookout archived it.`;
const CLOSED_NOTE = /^Closed: the posting was gone \(.*\) as of \d{4}-\d{2}-\d{2}\. Lookout archived it\.$/gm;

/** The same closed line for Postgres (newline-sensitive "n" flag), to drop closed-only notes inside a query (#1050). */
export const CLOSED_NOTE_SQL = CLOSED_NOTE.source;

/** The line Lookout adds to a closed find it keeps closed when the job comes back at a new link (#922). */
export const repostedNote = (day: string, url: string) => `Reposted on ${day}: ${url}`;
const REPOSTED_NOTE = /^Reposted on \d{4}-\d{2}-\d{2}: \S+$/gm;

/** Every line Lookout writes into notes, closed and reposted, for Postgres like CLOSED_NOTE_SQL (#1362). */
export const LOOKOUT_NOTES_SQL = `${CLOSED_NOTE.source}|${REPOSTED_NOTE.source}`;

/** A find's notes without Lookout's own closed and reposted lines: what the person wrote (#792, #1362). */
export const ownNotes = (notes: string) => notes.replace(CLOSED_NOTE, "").replace(REPOSTED_NOTE, "").trim();

// Phrases job boards use for a posting that's no longer live. Checked against the start of the page text only.
const CLOSED = [
  // Not "no longer open to candidates requiring sponsorship" (#903), "no longer accepting candidates from agencies" (#933),
  // or "no longer accepting applications via email; apply on this page" (#1027).
  /no longer (accepting (applications|applicants|candidates)\b(?! (from|via|by (e-?mail|mail|post|phone|fax)|through (e-?mail|mail|linkedin|indeed|recruiters?|agencies))\b))/i,
  // "Live" too: "This job is no longer live" (#1451).
  // Not "no longer available to candidates outside the US" or "for applicants who need a visa": who may apply changed, the
  // job did not end (#1589). "No longer available to apply" still closes.
  // "Available", "active" and "posted" need the job as the subject, or start a sentence: "Visa sponsorship is no longer
  // available for this role" is about the visa, not the job (#933).
  // Not "Visa sponsorship for this position is no longer available": there the job is the object of "for" (#980). "For
  // this job posting" too: the guard skips one leading job noun (#1569).
  // Not "the opportunity to work fully remote is no longer available": the noun leads into something else (#1007).
  // Not "This role is no longer available as fully remote" or "no longer available in Austin": the job changed, it did not
  // end (#1494).
  /(?<!\b(?:for|of|to|on|with|in|about) (?:this |the |a |our )?(?:(?:job|role|position) )?)\b(job|position|posting|role|opening|requisition|listing|vacancy|opportunity|page)\b(?!\s+to\b)[^.!?\n]{0,30}?\bno longer (available|active|posted|live|open(?! to\b))\b(?!\s+(?:as|in|at)\b|\s+(?:fully\s+)?(?:remote|hybrid|on-?site)\b|\s+for\s+(?:fully\s+)?(?:remote|hybrid|on-?site)\b|\s+(?:to|for)\s+(?:[\w’'-]+\s+){0,3}?(?:candidates|applicants|people|persons|residents|anyone|those|individuals|workers|contractors|students|graduates|citizens|employees)\b)/i,
  // "Open" likewise: "Our San Francisco office is no longer open" is about the office (#1298).
  // A colon starts one only after a status label: "Visa sponsorship: No longer available" is about the visa (#1007).
  /(?:^|[.!?\n]\s*|\b(?:text|status|job status|posting status|job|posting|position|role):\s*)(?:sorry[,!]?\s*)?no longer (available|active|posted|live|open(?! to\b))\b(?!\s+(?:to|for)\s+(?:[\w’'-]+\s+){0,3}?(?:candidates|applicants|people|persons|residents|anyone|those|individuals|workers|contractors|students|graduates|citizens|employees)\b)/im,
  // Not "open until the position has been filled" or "once the position has been filled, this posting will be removed" (#903).
  // Built In's "Sorry, this job was removed at 3:14 a.m. ...": "was" with filled, closed or removed only, so "this role was
  // available to remote candidates" stays open (#1271). "Has been archived" and "was archived" too (#1279).
  // Deleted, withdrawn, unpublished, cancelled and taken down too, but not "taken down to three days a week" (#1451).
  /(?<!\b(?:(?:until|till|til)(?: such time as)?|once|when|after|if|before|unless|for|of|to|on|with|in|about) (?:the |this |a |our )?(?:(?:job|role|position) )?)(?<!\b(?:each|every|any|all|no|which|whether) (?:(?:job|role|position) )?)(job|position|posting|role|requisition|opening|vacancy|opportunity|listing)( ad)? ((is )?no longer (available|filled|closed|removed|archived|deleted|withdrawn|unpublished|cancell?ed|taken down)(?!\s+(?:as|in|at)\b|\s+(?:fully\s+)?(?:remote|hybrid|on-?site)\b|\s+for\s+(?:fully\s+)?(?:remote|hybrid|on-?site)\b|\s+(?:to|for)\s+(?:[\w’'-]+\s+){0,3}?(?:candidates|applicants|people|persons|residents|anyone|those|individuals|workers|contractors|students|graduates|citizens|employees)\b)|(is )?has (?:already |now )?been (available|filled|closed|removed|archived|deleted|withdrawn|unpublished|cancell?ed|taken down)|was (filled|closed|removed|archived|deleted|withdrawn|unpublished|cancell?ed|taken down)\b)(?! to\b)/i,
  // Ending there too, as below (#1516).
  /(job|posting|position|page) (was )?not found(?=\s*(?:[.!?,;:|)\n-]|$))/i,
  /(?<!\b(?:until|till|til|once|when|after|if|before|unless) )this (job|position|posting|role)( ad)? (is |has )?(now )?(expired|closed|been filled)\b(?! to\b|[- ]?date\b|-)/i,
  // More wordings careers sites use (#747).
  // Not a live page's "Job Posting Expired Date: 12/31" label (#1083).
  // "This job post has expired", "This advert has expired" (#1279). "This job posting is expired", "This job opening has expired" (#1361).
  // The phrase must end there, or go on to a date: "customers whose job posting expired renew it" and "the listing has
  // expired items" are duties (#1516).
  /\b(job|posting|position|listing|vacancy|opportunity|role|advert|opening|requisition)( ad| advert| post| posting| opening)? (is |has )?(now )?expired\b(?![- ]?date\b)(?=\s*(?:[.!?,;:|)\n-]|$)|\s+(?:on|as of|since|and|or)\b)/i,
  // "The job you are trying to apply for is no longer available", "attempting to view" too (#1251). "Apply to" too (#1441).
  /(job|position|posting|role|page) you(['’]re| are| were) (looking for|(trying|attempting) to (apply (for|to)|access|view|reach|open)) ((has|is|was|might have|may have) (been )?(filled|removed|closed|deleted|expired)|is no longer (available|active|open))\b/i,
  /(job|position|posting|role|opening) is not available anymore/i,
  // A duty about such a screen is not one: "the screen that says the page you're looking for doesn't exist", "customers who
  // can't find the page they need", "users who couldn't find the page, across web" (#1553).
  /(?<!\b(?:says|said|saying|reads|shows|showing|tells (?:them|users|people|you)|like|when|if|where|that|which) (?:that )?(?:the |this )?)page you(['’]re| are| were) looking for (doesn['’]t|does not|no longer) exists?|(?<!\bwho )(can(['’]|no)t|couldn['’]t|could not) find (that|this|the) page(?=\s*(?:[.!?\n]|$)|\s+you(?:['’]re| are| were)? (?:looking for|requested|wanted))/i,
  // A soft 404 that answers 200: "The page you requested could not be found", "This page cannot be found." (#1441).
  // "This/the X cannot be found" only as the end of the sentence, so "the job cannot be found on other boards" stays open.
  /\b(page|job|position|posting) you(['’]ve| have)? requested (could not|cannot|can['’]t) be found|\b(this|the) (page|job|position|posting) (could not|cannot|can['’]t) be found\s*(?:[.!?\n]|$)/i,
  // Careers sites usually render a curly apostrophe (#734). "The page you were looking for" too (#1692).
  /(the )?(job|position|page) you(['’]re| are| were) looking for (is no longer|could not be|can(['’]|no)t be) (available|found)/i,
  // Not "Applications for this role are closed to agencies" (#1103). Any noun for the job: "this vacancy" too (#1158).
  /applications (for this (job|role|position|posting|vacancy|opportunity|listing|opening) )?(are|is|have) (now )?closed\b(?! to\b)/i,
  // "Applications are no longer being accepted", but not from agencies or by email, as above (#1158).
  /applications (are|is) no longer being (accepted|considered)\b(?! (from|via|by (e-?mail|mail|post|phone|fax)|through (e-?mail|mail|linkedin|indeed|recruiters?|agencies))\b)/i,
  // "This job posting has closed", "This vacancy has now closed", "Job Closed", but not "closed to contractors" (#760),
  // a live page's "Position Closed Date: 11/30" label or "closed-loop" (#832).
  // "This job post is closed" and "This job advert has now closed" too (#1279). "This job opening is closed" and
  // "This requisition is closed" (#1361).
  // Not a duty about other jobs: "every requisition is closed out", "each role is closed in Greenhouse", "the opportunity is
  // closed won" (#1493).
  /(?<!\b(?:each|every|any|all|no|which|whether) (?:(?:job|role|position) )?)\b(job|posting|position|role|vacancy|opportunity|listing|advert|opening|requisition)( posting| post| ad| advert| opening)? (is |has )?(now )?closed\b(?! to\b|[- ]?date\b|-|\s+(?:out|won|lost)\b)/i,
  // Not "not accepting applications at this time from third-party recruiters" (#1083).
  /not accepting applications (for this (job|role|position)|at this time)(?!,? (from|via|by|through)\b)/i,
  // Only as the page's own message, ending the line, sentence or title: "Own our 404 page not found experience" and "Page
  // not found errors are something you'll debug" are duties (#1516).
  /(?:\bpage not found|\b404\b.{0,40}(not found|doesn.t exist))(?=\s*(?:[.!?,;:|)\n-]|$))/i,
  // Stock closed-job pages (#1427): "This job no longer exists", "The job you are looking for does not exist", "Sorry, this
  // job is not available". Only as the end of the sentence, so "a role that doesn't exist yet" or "this role is not
  // available for visa sponsorship" stay open.
  /\b(job|position|posting|role|opening|listing|vacancy|requisition)( listing| posting| post| ad)?\b[^.!?\n]{0,40}?\b(no longer exists?|does(?:n['’]t| not) exist)( anymore| any longer)?\s*(?:[.!?\n]|$)/i,
  /\b(this|the) (job|position|posting|role|opening|listing|vacancy)( you(['’]re| are) looking for)? is (currently )?not available( anymore)?\s*(?:[.!?\n]|$)/i,
  // "This position is not currently accepting applications", but not from agencies or by email, as above.
  /\b(is|are) not currently accepting (applications|applicants|candidates)\b(?!,? (from|via|by|through)\b)/i,
  // "Applications closed" on its own line, and "The application deadline has passed".
  /(?:^|\n)\s*applications? (?:are )?closed\s*[.!]?\s*(?:\n|$)/i,
  /\b(application|applications|submission) deadline (has|have) (now )?passed\b/i,
  // "The deadline to apply for this job has passed", "The deadline for this position has passed", "The application
  // deadline for this role has now passed" (#1714). The job or applying must follow "deadline".
  /\bdeadline (?:to apply|for (?:applications|applying|submissions|(?:this|the) (?:job|role|position|posting|vacancy|opening|opportunity)))\b[^.!?\n]{0,40}?\bhas (?:now |already )?passed\b/i,
  // "We're no longer hiring for this role", "We are no longer recruiting for this position" (#1458). The job must follow,
  // so "no longer hiring for our old office" or "we're no longer recruiting through agencies" stays open.
  /\bno longer (hiring|recruiting) for (this|the) (job|role|position|posting|opening|vacancy|requisition|opportunity)\b/i,
  // "We have stopped accepting applications for this job", but not from agencies or by email, as above (#1458).
  /\b(have|has|we['’]ve) (now )?stopped accepting (applications|applicants|candidates)\b(?!,? (from|via|by|through)\b)/i,
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

// A closed phrase someone reports is a duty about such a screen: "the page that tells seekers this job has expired", "the
// page where a job posting has expired" (#1591). Checked in the clause right before the phrase.
const REPORTED = /\b(tells?|telling|told|says|saying|shows|showing|displays|displaying|warns?|warning|notif(?:y|ies|ying)|explains?|lets? (?:\w+ ){1,2}know|where)\b/i;
// A condition right after the phrase makes it a rule about other postings: "a listing is no longer live once the role is
// filled" (#1591).
const THEN_CONDITION = /^\s*(?:once|when|whenever|after|until|till|if|as soon as)\b/i;

// A closed phrase given as an example is copy to write, not the page's own message: "write error messages like 'This job
// is no longer available'" or "rewrite \"Page not found\"" (#1620): an opening quote not yet closed before the phrase, or
// "like" or "such as" right before it, but not "looks like this job is no longer available". A closing quote ("Senior Designer" is ...) follows a word, so it doesn't count.
const QUOTED = /(?:^|[\s(\[:])["“‘'][^"“”‘’'\n]{0,40}$|(?<!\b(?:looks?|looked|seems?|seemed|sounds?) )\b(?:like|such as)\s+(?:(?:the|this|a|your|our)\s+)?$/i;

const lastOf = (s: string, marks: string[]) => Math.max(...marks.map((c) => s.lastIndexOf(c)));

/**
 * A closed phrase counts unless it is led into with a condition (#980), reported, followed by a condition (#1591), or
 * quoted as an example (#1620).
 */
function saysClosed(r: RegExp, text: string) {
  for (const m of text.matchAll(new RegExp(r.source, r.flags.includes("g") ? r.flags : `${r.flags}g`))) {
    // A match can start on the separator before the phrase ("\nNo longer available"): look back from the phrase itself,
    // not from the line above (#1006).
    const before = text.slice(0, m.index + (/^[.!?:;\n\s]*/.exec(m[0])?.[0].length ?? 0));
    const sentence = before.slice(lastOf(before, [".", "!", "?", "\n", ";"]) + 1);
    const clause = sentence.slice(lastOf(sentence, [",", ":"]) + 1);
    if (REPORTED.test(clause) || QUOTED.test(before) || THEN_CONDITION.test(text.slice(m.index + m[0].length))) continue;
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
