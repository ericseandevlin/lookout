import { createHash } from "node:crypto";
import { hashRoute } from "@/lib/extension/match";

export type Scored = {
  score: number;
  reasonsMatch: string[];
  reasonsGap: string[];
  locationFit: boolean;
  dealbreaker: boolean;
  compMin: number | null;
  compMax: number | null;
};

// A gap already about pay. Whole words, so "Company is early stage" or "payments experience" don't count (#658).
const PAY_GAP = /\b(comp|compensation|pay|salary|salaries|wages?)\b/i;

/**
 * Hard rules applied on top of the model's score. The model's score is a
 * ceiling candidate; rules can only lower it. Returns null when the find
 * should not be added at all.
 */
export function applyRules(s: Scored, floor: number | null) {
  if (s.dealbreaker) return null;
  let cap = 5;
  const gap = [...s.reasonsGap];
  const topComp = s.compMax ?? s.compMin;
  if (floor && topComp && topComp < floor) {
    cap = Math.min(cap, 3);
    if (!gap.some((g) => /floor/i.test(g))) gap.unshift("Top of the posted range is below your floor");
  }
  if (!s.locationFit) cap = Math.min(cap, 3);
  if (!topComp && !gap.some((g) => PAY_GAP.test(g))) gap.push("No comp posted");
  const score = Math.max(1, Math.min(5, Math.round(s.score), cap));
  return { score, reasonsMatch: s.reasonsMatch.slice(0, 5), reasonsGap: gap.slice(0, 5) };
}

/**
 * Letters and digits from scripts other than Latin (Japanese, Cyrillic, Greek, Arabic and so on), which the a-z/0-9 key
 * drops. Latin letters (accented ones too) and ASCII digits are removed here, so text in Latin script alone adds nothing
 * and every key stored before #1075 stays the same.
 */
const otherScript = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{Script=Latin}0-9]\p{M}*/gu, " ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();

/** The a-z/0-9 words, then any non-Latin words, so "メルカリ" and "ソニー" no longer both normalize to "" (#1075). */
const withOtherScript = (s: string) => {
  const latin = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const other = otherScript(s);
  return other ? `${latin} ${other}`.trim() : latin;
};

const normPart = (s: string) => withOtherScript(s.replace(/\(.*?\)/g, " "));

/** A title with its parentheticals kept, to tell "Designer (Payments)" from "Designer (Identity)" (#838). */
export const fullTitle = (t: string) => withOtherScript(t);

export function fingerprint(company: string, title: string, location: string) {
  // nosemgrep: javascript.lang.security.audit.node-sha1.node_sha1 -- SHA-1 here only fingerprints postings for dedupe, not security
  return createHash("sha1")
    .update([company, title, location.split(",")[0]].map(normPart).join("|"))
    .digest("hex");
}

// Tracking params only, matched by exact name, so job IDs like referenceId or refnum stay in the key (#487). Ad and email
// click IDs too: Google, Meta, Microsoft, LinkedIn, Instagram, HubSpot, Mailchimp, Marketo and the Google linker (#1193).
const TRACKING =
  /^(utm_.*|gh_src|source|src|ref|refid|ref_src|referrer|trk|trackingid|lever-source|lever-origin|gclid|gbraid|wbraid|dclid|fbclid|msclkid|li_fat_id|igshid|_hsenc|_hsmi|mc_cid|mc_eid|mkt_tok|_gl)$/i;

/** A query pair's name, decoded when it can be. */
const pairName = (p: string) => {
  const k = p.split("=")[0].replace(/\+/g, " ");
  try {
    return decodeURIComponent(k);
  } catch {
    return k;
  }
};

export function normUrl(u: string) {
  try {
    const url = new URL(u);
    // Drop tracking pairs from the query text itself: URLSearchParams.delete rewrote the rest in form encoding ("%20" as
    // "+", "," as "%2C"), so a link with a tracking tag no longer matched the same link stored without one (#1166).
    const kept = url.search.slice(1).split("&").filter((p) => p && !TRACKING.test(pairName(p)));
    const query = kept.length ? `?${kept.join("&")}` : "";
    return (url.host.replace(/^www\./, "") + url.pathname.replace(/\/$/, "") + query + hashRoute(url)).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}
