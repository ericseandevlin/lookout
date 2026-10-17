import { createHash } from "node:crypto";

export type Scored = {
  score: number;
  reasonsMatch: string[];
  reasonsGap: string[];
  locationFit: boolean;
  dealbreaker: boolean;
  compMin: number | null;
  compMax: number | null;
};

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
  if (!topComp && !gap.some((g) => /comp|pay|salary/i.test(g))) gap.push("No comp posted");
  const score = Math.max(1, Math.min(5, Math.round(s.score), cap));
  return { score, reasonsMatch: s.reasonsMatch.slice(0, 5), reasonsGap: gap.slice(0, 5) };
}

const normPart = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function fingerprint(company: string, title: string, location: string) {
  // nosemgrep: javascript.lang.security.audit.node-sha1.node_sha1 -- SHA-1 here only fingerprints postings for dedupe, not security
  return createHash("sha1")
    .update([company, title, location.split(",")[0]].map(normPart).join("|"))
    .digest("hex");
}

export function normUrl(u: string) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|gh_src|source|ref|src)/i.test(k)) url.searchParams.delete(k);
    return (url.host.replace(/^www\./, "") + url.pathname.replace(/\/$/, "") + url.search).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}
