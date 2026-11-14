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

/** Latin letters NFKD leaves whole, spelled the way a plain-ASCII page writes them. */
const FOLD: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };

/**
 * Accents dropped from Latin letters, so "Montréal" keys as "Montreal" whether the é is stored as one character or as e
 * plus a combining mark (#1269). Only the a-z pass uses it: non-Latin text keeps its marks in otherScript.
 */
const foldLatin = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (c) => FOLD[c]);

/** The a-z/0-9 words, then any non-Latin words, so "メルカリ" and "ソニー" no longer both normalize to "" (#1075). */
const withOtherScript = (s: string, fold = true) => {
  const latin = (fold ? foldLatin(s) : s.toLowerCase()).replace(/[^a-z0-9]+/g, " ").trim();
  const other = otherScript(s);
  return other ? `${latin} ${other}`.trim() : latin;
};

const normPart = (fold: boolean) => (s: string) => withOtherScript(s.replace(/\(.*?\)/g, " "), fold);

/** A title with its parentheticals kept, to tell "Designer (Payments)" from "Designer (Identity)" (#838). */
export const fullTitle = (t: string) => withOtherScript(t);

const key = (company: string, title: string, location: string, fold: boolean) =>
  // nosemgrep: javascript.lang.security.audit.node-sha1.node_sha1 -- SHA-1 here only fingerprints postings for dedupe, not security
  createHash("sha1")
    .update([company, title, location.split(",")[0]].map(normPart(fold)).join("|"))
    .digest("hex");

export const fingerprint = (company: string, title: string, location: string) => key(company, title, location, true);

/**
 * The key stored before #1269, when an accented letter became a space ("montr al"). The same as fingerprint for text with
 * no accents. postingKey looks it up so a posting saved under it is matched, not saved again.
 */
export const legacyFingerprint = (company: string, title: string, location: string) => key(company, title, location, false);

const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut",
  de: "delaware", dc: "district of columbia", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois",
  in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska",
  nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island",
  sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia",
  wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming", pr: "puerto rico",
};
// None of these codes is also a US state's.
const CA_PROVINCES: Record<string, string> = {
  ab: "alberta", bc: "british columbia", mb: "manitoba", nb: "new brunswick", nl: "newfoundland and labrador",
  ns: "nova scotia", nt: "northwest territories", nu: "nunavut", on: "ontario", pe: "prince edward island",
  qc: "quebec", sk: "saskatchewan", yt: "yukon",
};
/** A state or province, by code or name, as "us-ny" or "ca-on". "CA" is California, the way US postings write it. */
const STATES = new Map<string, string>(
  (
    [
      ["us", US_STATES],
      ["ca", CA_PROVINCES],
    ] as const
  ).flatMap(([c, m]) => Object.entries(m).flatMap(([code, name]) => [[code, `${c}-${code}`] as const, [name, `${c}-${code}`] as const])),
);
const COUNTRIES = new Map<string, string>([
  ...["us", "usa", "u s", "u s a", "united states", "united states of america", "america"].map((n) => [n, "us"] as const),
  ...["uk", "u k", "gb", "united kingdom", "great britain", "britain", "england", "scotland", "wales", "northern ireland"].map((n) => [n, "gb"] as const),
  ["canada", "ca"],
]);

/**
 * The state and country after a location's first comma: "Portland, OR" is { state: "us-or", country: "us" }, "Remote,
 * Canada" is { country: "ca" }. A country not known here stands as its own text, so "Remote, Mexico" still differs from
 * "Remote, US". ZIP codes are dropped ("NY 10001").
 */
export function region(location: string) {
  let state: string | null = null;
  let country: string | null = null;
  let other: string | null = null;
  for (const part of location.split(",").slice(1)) {
    const p = normPart(true)(part).replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim();
    if (!p) continue;
    const s = STATES.get(p);
    if (s) state ??= s;
    else if (COUNTRIES.has(p)) country ??= COUNTRIES.get(p)!;
    else other = p;
  }
  return { state, country: country ?? state?.slice(0, 2) ?? other };
}

/**
 * Two locations that share the fingerprint's city but are in different places: both name a country and they differ, or
 * both name a state and those differ. "New York, NY" and "New York, New York" are one place; "Remote, US" and "Remote,
 * Canada", or "Portland, OR" and "Portland, ME", are two (#1285). A location with no region differs from none.
 */
export function placesDiffer(a: string, b: string) {
  const x = region(a);
  const y = region(b);
  return (!!x.country && !!y.country && x.country !== y.country) || (!!x.state && !!y.state && x.state !== y.state);
}

/** The region a posting is keyed under when it shares a city with a posting somewhere else: the state, else the country. */
export const placeId = (location: string) => {
  const r = region(location);
  return r.state ?? r.country ?? "";
};

// Tracking params only, matched by exact name, so job IDs like referenceId or refnum stay in the key (#487). Ad and email
// click IDs too: Google, Meta, Microsoft, LinkedIn, Instagram, HubSpot, Mailchimp, Marketo and the Google linker (#1193).
// Jobvite's source tags __jvst and __jvsd (#1252).
const TRACKING =
  /^(utm_.*|gh_src|source|src|ref|refid|ref_src|referrer|trk|trackingid|lever-source|lever-origin|gclid|gbraid|wbraid|dclid|fbclid|msclkid|li_fat_id|igshid|_hsenc|_hsmi|mc_cid|mc_eid|mkt_tok|_gl|__jvst|__jvsd)$/i;

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
