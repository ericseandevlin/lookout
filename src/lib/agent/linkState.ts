/** Pure classification of a posting check, kept apart from the DB code so it's testable. */
export type LinkState = "open" | "gone" | "unknown";

// Phrases job boards use for a posting that's no longer live. Checked against the start of the page text only.
const CLOSED = [
  /no longer (accepting applications|available|open|active|posted)/i,
  /(job|position|posting|role|requisition|opening) (is )?(no longer|has been) (available|filled|closed|removed)/i,
  /(job|posting|position|page) (was )?not found/i,
  /this (job|position|posting|role)( ad)? (is |has )?(now )?(expired|closed|been filled)\b/i,
  // More wordings careers sites use (#747).
  /\b(job|posting|position|listing)( ad)? (has )?expired\b/i,
  /(job|position|posting|role|page) you(['’]re| are) (looking for|trying to (apply for|access|view|reach)) (has|is|was) (been )?(filled|removed|closed|deleted|expired)\b/i,
  /(job|position|posting|role|opening) is not available anymore/i,
  /page you(['’]re| are) looking for (doesn['’]t|does not|no longer) exists?|(can(['’]|no)t|couldn['’]t|could not) find (that|this|the) page/i,
  // Careers sites usually render a curly apostrophe (#734).
  /(the )?(job|position) you(['’]re| are) looking for (is no longer|could not be|can(['’]|no)t be) (available|found)/i,
  /applications (for this (job|role|position) )?(are|is) (now )?closed/i,
  /\bpage not found\b|\b404\b.{0,40}(not found|doesn.t exist)/i,
];
// Pages that prove nothing either way.
const NOT_A_VERDICT = [/maintenance/i, /temporarily unavailable/i, /access denied|forbidden|captcha|verify you are human|enable javascript/i];

export function classifyPage(status: number, text: string, finalUrl = ""): { state: LinkState; reason: string } {
  if (status === 404 || status === 410) return { state: "gone", reason: `page answered ${status}` };
  // Greenhouse sends a closed job to the company's board with ?error=true.
  if (/[?&]error=true\b/.test(finalUrl)) return { state: "gone", reason: "the job board says it's closed" };
  if (status !== 200) return { state: "unknown", reason: `page answered ${status}` };
  const head = text.slice(0, 2500);
  // Closed wording wins: real "job not available" pages often mention maintenance or sign-in somewhere too.
  if (CLOSED.some((r) => r.test(head))) return { state: "gone", reason: "page says it's closed" };
  if (NOT_A_VERDICT.some((r) => r.test(head))) return { state: "unknown", reason: "site unavailable or blocked" };
  return { state: "open", reason: "posting is up" };
}
