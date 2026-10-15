/** Pure classification of a posting check, kept apart from the DB code so it's testable. */
export type LinkState = "open" | "gone" | "unknown";

// Phrases job boards use for a posting that's no longer live. Checked against the start of the page text only.
const CLOSED = [
  /no longer (accepting applications|available|open|active|posted)/i,
  /(job|position|posting|role|requisition|opening) (is )?(no longer|has been) (available|filled|closed|removed)/i,
  /(job|posting|position|page) (was )?not found/i,
  /this (job|position|posting|role) (has )?(expired|closed|been filled)/i,
  /(the )?(job|position) you('re| are) looking for (is no longer|could not be|can('|no)t be) (available|found)/i,
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
  if (NOT_A_VERDICT.some((r) => r.test(head))) return { state: "unknown", reason: "site unavailable or blocked" };
  const hit = CLOSED.find((r) => r.test(head));
  if (hit) return { state: "gone", reason: "page says it's closed" };
  return { state: "open", reason: "posting is up" };
}
