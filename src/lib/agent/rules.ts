import { createHash } from "node:crypto";
import { hashRoute, jobKey } from "@/lib/extension/match";

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
 * Em and en dashes become a comma: reasons are read as plain copy, and Lookout never writes one (#1531). A dash between
 * two numbers is a range, so it becomes a hyphen: "$180k–$220k" is "$180k-$220k", not "$180k, $220k" (#1766). A pay unit or
 * a time of day after the first number keeps it a range too: "$90/hr–$110/hr", "$60 an hour – $75", "10am–6pm" (#1807).
 */
const RANGE_START = /(\d[\d,.]*(?:[kKmM%]|\s?[ap]\.?m\.?|\s?(?:\/\s?|an? |per )(?:hr|hour|yr|year|mo|month|wk|week)\b)?)\s*[\u2014\u2013]\s*(?=[$€£]?\d)/g;
export const noDashes = (s: string) =>
  s
    .replace(RANGE_START, "$1-")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .trim();

/**
 * Hard rules applied on top of the model's score. The model's score is a
 * ceiling candidate; rules can only lower it. Returns null when the find
 * should not be added at all.
 */
export function applyRules(s: Scored, floor: number | null) {
  if (s.dealbreaker) return null;
  let cap = 5;
  const gap = [...s.reasonsGap];
  const topComp = s.compMax ?? s.compMin; // One number counts as the top, even a starting pay (Eric, #877).
  if (floor && topComp && topComp < floor) {
    cap = Math.min(cap, 3);
    if (!gap.some((g) => /floor/i.test(g))) gap.unshift("Top of the posted range is below your floor");
  }
  if (!s.locationFit) cap = Math.min(cap, 3);
  if (!topComp && !gap.some((g) => PAY_GAP.test(g))) gap.push("No comp posted");
  const score = Math.max(1, Math.min(5, Math.round(s.score), cap));
  return { score, reasonsMatch: s.reasonsMatch.slice(0, 5).map(noDashes), reasonsGap: gap.slice(0, 5).map(noDashes) };
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

// A legal form after the name: "Acme, Inc." on the ATS page is "Acme" on LinkedIn (#1645). Only at the end, so "Co-op" and
// "Limited Brands" keep theirs; "Pty Ltd" goes as a pair.
const LEGAL_FORM = /(?:[\s,]+(?:inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|ag|s\.a|sa|b\.v|bv|pty|llp|l\.p|lp)\.?)+\s*$/i;
export const bareCompany = (c: string) => c.replace(LEGAL_FORM, "").trim() || c;

const key = (company: string, title: string, location: string, fold: boolean, bare = fold) =>
  // nosemgrep: javascript.lang.security.audit.node-sha1.node_sha1 -- SHA-1 here only fingerprints postings for dedupe, not security
  createHash("sha1")
    // The legacy key (fold false) keeps the location as written, so postings stored before #1514 are still matched.
    .update([bare ? bareCompany(company) : company, title, (fold ? remoteFirst(location) : location).split(",")[0]].map(normPart(fold)).join("|"))
    .digest("hex");

export const fingerprint = (company: string, title: string, location: string) => key(company, title, location, true);

/**
 * The key stored from #1269 until #1645, with the company's legal form kept ("acme inc"). The same as fingerprint for a
 * company with none. postingKey looks it up so a posting saved under it is matched, not saved again.
 */
export const suffixedFingerprint = (company: string, title: string, location: string) => key(company, title, location, true, false);

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

// Words that say how someone works in a place, not which place. "or", "in" and "on" alone are Oregon, Indiana and
// Ontario, so they go only as a joining word ("NY or Remote") or as "in office" and "on site".
const QUALIFIER = /\b(?:remote|hybrid|on ?site|in ?office|metro(?:politan)?|area|only|based)\b/g;
const withoutQualifier = (p: string) =>
  p
    .replace(QUALIFIER, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:or|and) (?=\S)|(?<=\S) (?:or|and)$/g, "");

// Words in "Remote (...)" that are terms of the job, not a place (#1555).
const NOT_PLACE = /^(?:(?:full|part) ?time|contract(?:or)?|temporary|temp|permanent|freelance|flexible|anywhere|ft|pt)$/;

const known = (p: string) => STATES.has(p) || COUNTRIES.has(p);

// Countries whose ISO code is also a US state's or Canadian province's: ATS feeds write "Berlin, DE" and LinkedIn
// writes "Berlin, Germany", and DE alone reads as Delaware (#1561). Each code with the names that country goes by.
const ISO_CLASH: Record<string, string[]> = {
  al: ["albania"], ar: ["argentina"], az: ["azerbaijan"], co: ["colombia"], de: ["germany", "deutschland"],
  ga: ["gabon"], id: ["indonesia"], il: ["israel"], in: ["india"], ky: ["cayman islands"], la: ["laos"],
  ma: ["morocco"], md: ["moldova"], me: ["montenegro"], mn: ["mongolia"], mo: ["macao", "macau"], mt: ["malta"],
  nc: ["new caledonia"], ne: ["niger"], nl: ["netherlands", "the netherlands", "holland"], pa: ["panama"],
  pe: ["peru"], sc: ["seychelles"], sd: ["sudan"], sk: ["slovakia"], tn: ["tunisia"], va: ["vatican", "vatican city"],
};

// Two-letter country codes that are not also a state's or province's, and a few second names, as the name region()
// reads for that country: ATS feeds write "Paris, FR" and LinkedIn writes "Paris, France" (#1677). Only region() reads
// these, so the fingerprint and remoteFirst are unchanged.
const COUNTRY_NAME: Record<string, string> = {
  ae: "united arab emirates", at: "austria", au: "australia", be: "belgium", bg: "bulgaria", br: "brazil",
  ch: "switzerland", cl: "chile", cn: "china", cr: "costa rica", cz: "czech republic", dk: "denmark", ee: "estonia",
  eg: "egypt", es: "spain", fi: "finland", fr: "france", gr: "greece", hk: "hong kong", hr: "croatia", hu: "hungary",
  ie: "ireland", is: "iceland", it: "italy", jp: "japan", ke: "kenya", kr: "south korea", lt: "lithuania",
  lu: "luxembourg", lv: "latvia", mx: "mexico", my: "malaysia", ng: "nigeria", no: "norway", nz: "new zealand",
  ph: "philippines", pk: "pakistan", pl: "poland", pt: "portugal", ro: "romania", rs: "serbia", se: "sweden",
  sg: "singapore", si: "slovenia", th: "thailand", tr: "turkey", tw: "taiwan", ua: "ukraine", uy: "uruguay",
  vn: "vietnam", za: "south africa",
  uae: "united arab emirates", czechia: "czech republic", turkiye: "turkey", korea: "south korea",
  "republic of korea": "south korea",
  // A country's own name and a second English one: "Berlin, Deutschland" and "Amsterdam, Holland" against the English
  // name LinkedIn writes (#1677).
  holland: "netherlands", deutschland: "germany", espana: "spain", italia: "italy", brasil: "brazil",
  osterreich: "austria", schweiz: "switzerland", suisse: "switzerland", svizzera: "switzerland", polska: "poland",
  sverige: "sweden", norge: "norway", danmark: "denmark", suomi: "finland", nippon: "japan", nihon: "japan",
  "republic of ireland": "ireland", eire: "ireland", "people s republic of china": "china", prc: "china",
};

// States and regions outside the US and Canada, as the country region() reads for them: ATS feeds write "Munich,
// Bavaria" and LinkedIn writes "Munich, Germany" (#1702). Names as normPart folds them; no code that is also a US
// state's or a Canadian province's.
const SUBDIVISION: Record<string, string> = Object.fromEntries(
  (
    [
      ["australia", ["new south wales", "nsw", "victoria", "vic", "queensland", "qld", "western australia", "south australia", "tasmania", "australian capital territory", "northern territory"]],
      ["germany", ["bavaria", "bayern", "berlin", "hamburg", "hesse", "hessen", "baden wurttemberg", "baden wuerttemberg", "north rhine westphalia", "nordrhein westfalen", "lower saxony", "niedersachsen", "saxony", "sachsen", "brandenburg", "schleswig holstein", "rhineland palatinate", "rheinland pfalz", "thuringia", "thuringen", "bremen"]],
      ["india", ["karnataka", "maharashtra", "tamil nadu", "telangana", "delhi", "nct of delhi", "haryana", "uttar pradesh", "west bengal", "gujarat", "kerala", "andhra pradesh", "rajasthan"]],
      ["spain", ["catalonia", "catalunya", "cataluna", "community of madrid", "comunidad de madrid", "andalusia", "andalucia", "valencian community", "comunidad valenciana", "basque country", "pais vasco"]],
      ["netherlands", ["north holland", "noord holland", "south holland", "zuid holland", "north brabant", "noord brabant"]],
      ["france", ["ile de france", "auvergne rhone alpes", "provence alpes cote d azur", "occitanie", "nouvelle aquitaine", "hauts de france"]],
      ["italy", ["lombardy", "lombardia", "lazio", "piedmont", "piemonte", "emilia romagna", "tuscany", "toscana", "veneto"]],
      ["ireland", ["county dublin", "co dublin", "leinster", "county cork", "co cork"]],
      ["brazil", ["sao paulo", "rio de janeiro", "minas gerais"]],
      ["mexico", ["jalisco", "nuevo leon", "cdmx", "ciudad de mexico"]],
      ["poland", ["masovia", "masovian", "mazowieckie", "lesser poland", "malopolskie"]],
      ["japan", ["tokyo", "osaka", "kanagawa"]],
      ["china", ["guangdong", "zhejiang", "jiangsu"]],
    ] as const
  ).flatMap(([country, names]) => names.map((n) => [n, country])),
);

/**
 * "Remote - US", "US Remote", "USA (Remote)" and "Remote – United States" as "Remote, US", the way "Remote, US" and
 * "Remote (US)" already key: the fingerprint keeps only the text before the first comma, so one remote job written two
 * ways was two finds (#1514). Only a known country: "New York (Remote)" names a city and stays as it is.
 */
export function remoteFirst(location: string) {
  const i = location.indexOf(",");
  const first = i < 0 ? location : location.slice(0, i);
  if (!/\bremote\b/i.test(first)) return location;
  const rest = normPart(true)(first.replace(/[()]/g, " "))
    .replace(/\bremote\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z]) (?=[a-z]\b)/g, "$1");
  // "US-based", "anywhere in the US", "US East Coast": the same filler region() drops after a comma.
  const place = withoutZone(withPlace(withoutQualifier(rest)));
  if (!COUNTRIES.has(place)) return location;
  return `Remote, ${place}${i < 0 ? "" : location.slice(i)}`;
}

/** "anywhere in the us" and "within the united states" name a known place once their filler goes (#1466); anything else stays as it is. */
const withPlace = (p: string) => {
  const t = p.replace(/^(?:anywhere )?(?:in |within |across |throughout )?(?:the )?(?=\S)/, "");
  return known(t) ? t : p;
};

// A coast, part of the country or time zone after a known place: "US - East Coast", "United States, Eastern Time",
// "US (PST)" (#1510). Whole trailing words only, so "North Carolina" and "West Virginia" stay the states they are.
const ZONE =
  /^(.+?) (?:(?:east(?:ern)?|west(?:ern)?|central|mountain|pacific|atlantic|midwest(?:ern)?|(?:north|south)(?:east|west)?(?:ern)?)(?: (?:coast|time(?: ?zones?)?|time ?zones?|region|states|us))?|[ecmp][sd]?t)$/;
const withoutZone = (p: string) => {
  const m = p.match(ZONE);
  return m && known(m[1]) ? m[1] : p;
};

/**
 * The state and country after a location's first comma: "Portland, OR" is { state: "us-or", country: "us" }, "Remote,
 * Canada" is { country: "ca" }. A country not known here stands as its own text, so "Remote, Mexico" still differs from
 * "Remote, US". ZIP codes are dropped ("NY 10001").
 * A job listed at several places is read by its first, the one the fingerprint keeps: "New York, NY; San Francisco, CA"
 * is New York, not California (#1700). "Portland, OR or Remote" has no second place, and a list in brackets stays whole.
 */
const OTHER_PLACES = /\s*[;|]\s*(?![^()]*\))|\s+\/\s+(?![^()]*\))|\s+(?:or|and)\s+(?=[^,()]+,)(?![^()]*\))/;
export function region(raw: string) {
  const location = remoteFirst(raw.split(OTHER_PLACES)[0]);
  let state: string | null = null;
  let country: string | null = null;
  let other: string | null = null;
  let code: string | null = null;
  // A known state or country in parentheses names the place too: "Remote (US)" is not "Remote (Canada)" (#1426). Other
  // words there ("(hybrid)", "(NYC)") say nothing, so they never make two places of one. After "Remote" or nothing, an
  // unknown word is the place itself: "Remote (Germany)" is not "Remote (US)" (#1555).
  const parts = [
    ...location.split(",").slice(1).map((text) => ({ text, paren: false, open: false })),
    ...[...location.matchAll(/\(([^()]*)\)/g)].map((m) => ({
      text: m[1],
      paren: true,
      open: /^(?:remote)?$/i.test(location.slice(0, m.index).split(",").pop()!.replace(/[^\p{L}]+/gu, "")),
    })),
  ];
  for (const { text: part, paren, open } of parts) {
    // Dotted codes come out of normPart as single letters: "D.C." is "d c", read as "dc" (#1303).
    const p = normPart(true)(part)
      .replace(/\b\d+\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b([a-z]) (?=[a-z]\b)/g, "$1");
    if (!p) continue;
    // A work mode or "metro area" after a known place is not part of it: "NY - Hybrid", "IL Metro Area", "US-based" (#1374).
    const q = known(p) ? p : withoutZone(withPlace(withoutQualifier(p)));
    // A work mode on its own ("New York, Remote") or after an unknown country ("Germany - Hybrid") is not a place (#1385).
    if (!q || (paren && !known(q) && (!open || NOT_PLACE.test(q)))) continue;
    const s = STATES.get(q);
    if (s) {
      if (!state && q.length === 2) code = q;
      state ??= s;
    } else if (COUNTRIES.has(q)) country ??= COUNTRIES.get(q)!;
    else {
      // "The Netherlands" and "Netherlands", "The Philippines" and "Philippines" are one country (#1677).
      const n = q.replace(/^the (?=\S)/, "");
      other = SUBDIVISION[n] ?? COUNTRY_NAME[n] ?? n;
    }
  }
  return { state, country: country ?? state?.slice(0, 2) ?? other, code: country ? null : code };
}

/** "DE" on one side, with no country named beside it, and "Germany" on the other, with no state on that side: one place written two ways (#1561). */
const isoMatch = (x: ReturnType<typeof region>, y: ReturnType<typeof region>) =>
  !!x.code && !y.state && !!y.country && !!ISO_CLASH[x.code]?.includes(y.country);

/**
 * Two locations that share the fingerprint's city but are in different places: both name a country and they differ, or
 * both name a state and those differ. "New York, NY" and "New York, New York" are one place; "Remote, US" and "Remote,
 * Canada", or "Portland, OR" and "Portland, ME", are two (#1285). A location with no region differs from none.
 */
export function placesDiffer(a: string, b: string) {
  const x = region(a);
  const y = region(b);
  if (isoMatch(x, y) || isoMatch(y, x)) return false;
  return (!!x.country && !!y.country && x.country !== y.country) || (!!x.state && !!y.state && x.state !== y.state);
}

/** The region a posting is keyed under when it shares a city with a posting somewhere else: the state, else the country. */
export const placeId = (location: string) => {
  const r = region(location);
  return r.state ?? r.country ?? "";
};

// Tracking params only, matched by exact name, so job IDs like referenceId or refnum stay in the key (#487). Ad and email
// click IDs too: Google, Meta, Microsoft, LinkedIn, Instagram, HubSpot, Mailchimp, Marketo and the Google linker (#1193).
// Jobvite's source tags __jvst and __jvsd (#1252). Google's result tag srsltid, the older _ga linker, gad_source, the
// TikTok, X, Yandex, Reddit and Pinterest click IDs, and Lever's share tag lever-via (#1615).
const TRACKING =
  /^(utm_.*|gh_src|source|src|ref|refid|ref_src|referrer|trk|trackingid|lever-source|lever-origin|lever-via|gclid|gbraid|wbraid|dclid|fbclid|msclkid|li_fat_id|igshid|_hsenc|_hsmi|mc_cid|mc_eid|mkt_tok|_gl|_ga|gad_source|srsltid|ttclid|twclid|yclid|rdt_cid|epik|__jvst|__jvsd)$/i;

/** A query pair's name, decoded when it can be. An array name ("lever-source[]", Lever's shared links) is its plain name (#1431). */
const pairName = (p: string) => {
  const k = p.split("=")[0].replace(/\+/g, " ");
  let name = k;
  try {
    name = decodeURIComponent(k);
  } catch {
    // keep the raw name
  }
  return name.replace(/\[\]$/, "");
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

// LinkedIn's /jobs/view/<id> is one posting with a public page, not a list (#1547).
// Job board search and list pages, on any country site (indeed.co.uk, ca.linkedin.com): /jobs, /q-<title>-jobs.html,
// Indeed's /l-<place>-jobs.html, the mobile /m/jobs; Glassdoor's /Job/...-SRCH_... pages; any /search? page or path
// that ends in /jobs (#1537). Wellfound's /role/ and /location/ pages ("Product Designer Jobs in New York") (#1577).
const AGGREGATOR =
  /(indeed|linkedin|glassdoor|ziprecruiter|simplyhired|monster|careerbuilder)\.[a-z]{2,3}(\.[a-z]{2})?\/(jobs(?!\/view\/)|q-|l-|m\/jobs)|glassdoor\.[a-z]{2,3}(\.[a-z]{2})?\/(job\/|.*SRCH_)|wellfound\.com\/(role|location)s?\/|\/search\?|\/jobs\/?$/i;

// Other boards' list pages (#1614): Built In's /jobs/<category> on any city site, Dice's /jobs search, YC's /jobs and
// /jobs/role/<role>, RemoteOK's /remote-<tag>-jobs and We Work Remotely's /categories/. Their postings are /job/<slug>/<id>,
// /job-detail/<id>, /companies/<co>/jobs/<id>, /remote-jobs/<id> and /remote-jobs/<slug>.
const BOARD_LIST =
  /^(?:[a-z]+\.)?builtin[a-z]*\.com\/jobs(?:[/?]|$)|^dice\.com\/jobs(?:[/?]|$)|^ycombinator\.com\/jobs(?:[/?]|$)|^remoteok\.(?:com|io)\/remote-[^/?]+-jobs(?:[/?]|$)|^weworkremotely\.com\/categories\//i;

// ATS hosts where every posting has an ID jobKey reads, so an address there without one is the board, not a job.
const ATS_HOST = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com)$/i;

// More ATS hosts whose postings jobKey keys by ID (#1613). Their other job pages (SmartRecruiters' one-click form,
// Workable's old /jobs/<id>, Taleo Business Edition's viewRequisition?rid=) still hold a long number or a UUID, so only
// an address with neither is the board. jobs.workable.com is Workable's own job board: its postings have no /j/ code.
// Dayforce too (#1671).
const ATS_MORE = /(^|\.)(smartrecruiters\.com|workable\.com|teamtailor\.com|icims\.com|taleo\.net|dayforcehcm\.com)$/i;
const NAMES_ID = /\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Paylocity's board for one company is /Recruiting/Jobs/All/<company id>.
const PAYLOCITY_BOARD = /(^|\.)paylocity\.com\/recruiting\/jobs\/all(\/|$)/i;
// ATS hosts whose postings sit under one path part (#1812): BambooHR /careers/<id>, Recruitee /o/<slug>, Personio
// /job/<id>, JazzHR /apply/<code>/<slug>, Jobvite /<company>/job/<id>. Any other address there is the company's board.
const ATS_POSTING: [RegExp, RegExp][] = [
  [/(^|\.)bamboohr\.com$/i, /^\/careers\/\d+(?:\/|$)|^\/jobs\/view\.php$/i],
  [/(^|\.)recruitee\.com$/i, /^\/(?:[a-z]{2}\/)?o\/[^/]+/i],
  [/(^|\.)jobs\.personio\.(?:de|com)$/i, /^\/job\/\d+(?:\/|$)/i],
  [/(^|\.)applytojob\.com$/i, /^\/apply\/(?!jobs\/?$)[0-9a-z]{6,}(?:\/|$)/i],
  [/^jobs\.jobvite\.com$/i, /^\/[^/]+\/job\/[0-9a-z]+(?:\/|$)/i],
];
// A query pair that names one job: "?jobId=", "?id=", "?gh_jid=", "?req=", "?posting=" (#1806).
const JOB_PARAM = /^(?:.*id|job|req|requisition|posting|position)$/i;

/**
 * A company's own job search with a query: "acme.com/jobs?location=NYC", "metacareers.com/jobs?q=designer", "/jobs/?page=2"
 * (#1806). The bare "/jobs" was already a list; its query only filters it. A query with a job ID or a long number names one job.
 */
// A company's careers home and its search too, with or without a query (#1820): "acme.com/careers", "/careers/search",
// "/job-search?q=designer", "/open-positions", "/en/careers/open-roles", and the root of careers.acme.com or jobs.acme.com.
// "/careers?gh_jid=4001234005" is one job (Greenhouse's embed), and a hash route ("#/jobs/123") is left alone.
const LIST_PATH = /\/(?:jobs|careers|careers\/search|job-?search|search-jobs|open-positions|open-roles|openings|job-openings|current-openings)\/?$/i;
const CAREERS_HOST = /^(?:careers|jobs)\.[^.]+\.[a-z.]+$/i;
const jobsSearch = (url: URL) =>
  (LIST_PATH.test(url.pathname) || (CAREERS_HOST.test(url.hostname) && /^\/?$/.test(url.pathname))) &&
  !url.hash.includes("/") &&
  !NAMES_ID.test(url.search) &&
  !url.search
    .slice(1)
    .split("&")
    .some((p) => JOB_PARAM.test(pairName(p)));

/**
 * A job board search link that names one job, as that job's own page on the same country site (#1813): LinkedIn's
 * ?currentJobId= beside a search or collection, Indeed's ?vjk= on a search page, Glassdoor's ?jl= on a listing page. These
 * are read and deduped like any other copy of the job; listPage would drop them as searches. Any other link is unchanged.
 */
export function jobPageUrl(u: string): string {
  const key = jobKey(u);
  const m = key?.match(/^(linkedin|indeed|glassdoor):(.+)$/);
  if (!m) return u;
  const url = new URL(u);
  const id = encodeURIComponent(m[2]);
  const page =
    m[1] === "linkedin"
      ? `/jobs/view/${id}/`
      : m[1] === "indeed"
        ? `/viewjob?jk=${id}`
        : `/partner/jobListing.htm?jobListingId=${id}`;
  // Already the job's own page ("/jobs/view/<title>-<id>", "viewjob?jk=", "jobListing.htm"): keep the link as written.
  if (m[1] === "linkedin" ? /\/jobs\/view\//i.test(url.pathname) : m[1] === "indeed" ? /^\/viewjob\/?$/i.test(url.pathname) : /joblisting\.htm$/i.test(url.pathname)) return u;
  return `${url.protocol}//${url.host}${page}`;
}

/**
 * A search result that lists jobs rather than being one: a job board search page, or an ATS board home such as
 * jobs.lever.co/acme or acme.wd1.myworkdayjobs.com/External (#1537). Dropped before triage so it doesn't take a pick.
 */
export function listPage(u: string): boolean {
  if (AGGREGATOR.test(u)) return true;
  let host: string;
  try {
    const url = new URL(u);
    host = url.hostname;
    if (BOARD_LIST.test(host.replace(/^www\./i, "") + url.pathname + url.search)) return true;
  } catch {
    return false;
  }
  if (!jobKey(u)?.startsWith("url:")) return false;
  if (ATS_HOST.test(host)) return true;
  const url = new URL(u);
  if (jobsSearch(url)) return true;
  const { pathname, search } = url;
  if (PAYLOCITY_BOARD.test(host + pathname)) return true;
  const ats = ATS_POSTING.find(([h]) => h.test(host));
  if (ats) return !ats[1].test(pathname);
  return ATS_MORE.test(host) && !/^jobs\.workable\.com$/i.test(host) && !NAMES_ID.test(pathname + search);
}
