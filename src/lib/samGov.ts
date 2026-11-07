import { z } from "zod";

/**
 * SAM.gov Opportunities API (#272): federal solicitations for the rfp kind. Pure helpers here (query
 * building, mapping, filtering); the fetch and scoring live in src/lib/agent/rfp.ts. Needs SAM_API_KEY
 * (a free key from a SAM.gov account); without it rfp discovery stays off.
 */

export const SAM_URL = "https://api.sam.gov/opportunities/v2/search";
/** Solicitation, combined synopsis/solicitation, presolicitation: notices someone can still bid on. */
const PTYPES = "o,k,p";
const MAX_NAICS = 3;
const LOOKBACK_DAYS = 30;

/** Certifications the rfp profile offers, as SAM.gov set-aside codes. */
const SET_ASIDES: [RegExp, string][] = [
  [/\b8\s*\(?a\)?/i, "8A"],
  [/\bwosb\b|women[- ]owned/i, "WOSB"],
  [/\bsdvosb\b|service[- ]disabled/i, "SDVOSBC"],
  [/\bhub\s*zone\b/i, "HZC"],
  [/small business/i, "SBA"],
];

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : v ?? "");

/** Six-digit NAICS codes from the profile answer, at most three (one API call each). */
export function naicsCodes(answer: string | string[] | undefined) {
  return [...new Set(str(answer).match(/\b\d{6}\b/g) ?? [])].slice(0, MAX_NAICS);
}

/** Set-aside codes the business qualifies for, from the certifications answer. */
export function setAsideCodes(answer: string | string[] | undefined) {
  const s = str(answer);
  return SET_ASIDES.filter(([re]) => re.test(s)).map(([, code]) => code);
}

/** SAM.gov wants MM/dd/yyyy. */
export const samDate = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;

/** One URL per NAICS code (or one broad one when none are given), posted in the last 30 days. The key is added by the caller. */
export function samQueries(answers: Record<string, string | string[]>, now = new Date()) {
  const base = { postedFrom: samDate(new Date(now.getTime() - LOOKBACK_DAYS * 864e5)), postedTo: samDate(now), ptype: PTYPES, limit: "50" };
  const codes = naicsCodes(answers.naics);
  return (codes.length ? codes : [""]).map((ncode) => new URLSearchParams({ ...base, ...(ncode && { ncode }) }));
}

const Place = z.object({ city: z.object({ name: z.string().nullish() }).nullish(), state: z.object({ code: z.string().nullish(), name: z.string().nullish() }).nullish() }).nullish();
export const SamOpp = z.object({
  noticeId: z.string(),
  title: z.string(),
  fullParentPathName: z.string().nullish(),
  postedDate: z.string().nullish(),
  type: z.string().nullish(),
  typeOfSetAside: z.string().nullish(),
  typeOfSetAsideDescription: z.string().nullish(),
  responseDeadLine: z.string().nullish(),
  naicsCode: z.string().nullish(),
  active: z.string().nullish(),
  award: z.object({ amount: z.union([z.string(), z.number()]).nullish() }).nullish(),
  placeOfPerformance: Place,
  uiLink: z.string().nullish(),
});
export const SamResponse = z.object({ totalRecords: z.number().optional(), opportunitiesData: z.array(z.unknown()).default([]) });
export type SamOpportunity = z.infer<typeof SamOpp>;

export type RfpItem = {
  noticeId: string;
  title: string;
  agency: string;
  url: string;
  posted: string | null;
  due: string | null;
  setAside: string;
  setAsideCode: string;
  naics: string;
  place: string;
  value: number | null;
  type: string;
};

const ymd = (s: string | null | undefined) => {
  const m = s?.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

/** "DEPT OF DEFENSE.DEPT OF THE ARMY.W6QK ACC-RI" -> "Dept Of The Army": the sub-agency reads best on a board. */
function agencyOf(path: string | null | undefined) {
  const parts = (path ?? "").split(".").map((p) => p.trim()).filter(Boolean);
  const pick = parts[1] ?? parts[0] ?? "";
  return pick.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** One API record as a board item. Records that don't parse are dropped. */
export function toRfpItem(raw: unknown): RfpItem | null {
  const r = SamOpp.safeParse(raw);
  if (!r.success) return null;
  const o = r.data;
  const city = o.placeOfPerformance?.city?.name ?? "";
  const state = o.placeOfPerformance?.state?.code ?? o.placeOfPerformance?.state?.name ?? "";
  const amount = Number(o.award?.amount);
  return {
    noticeId: o.noticeId,
    title: o.title.trim(),
    agency: agencyOf(o.fullParentPathName),
    url: o.uiLink && /^https:\/\//.test(o.uiLink) ? o.uiLink : `https://sam.gov/opp/${encodeURIComponent(o.noticeId)}/view`,
    posted: ymd(o.postedDate),
    due: ymd(o.responseDeadLine),
    setAside: o.typeOfSetAsideDescription?.trim() ?? "",
    setAsideCode: o.typeOfSetAside?.trim() ?? "",
    naics: o.naicsCode?.trim() ?? "",
    place: [city, state].filter(Boolean).join(", "),
    value: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null,
    type: o.type?.trim() ?? "",
  };
}

/**
 * Notices still worth a look: active, not past due, not seen before, and either open to everyone or
 * set aside for something the business holds.
 */
export function keepRfps(raw: unknown[], opts: { today: string; known: Set<string>; setAsides: string[] }) {
  const out: RfpItem[] = [];
  const seen = new Set(opts.known);
  for (const r of raw) {
    const it = toRfpItem(r);
    if (!it || !it.title || seen.has(it.noticeId)) continue;
    const active = (r as { active?: string }).active;
    if (active && active.toLowerCase() === "no") continue;
    if (it.due && it.due < opts.today) continue;
    if (it.setAsideCode && it.setAsideCode !== "NONE" && !opts.setAsides.some((c) => it.setAsideCode.startsWith(c))) continue;
    seen.add(it.noticeId);
    out.push(it);
  }
  return out;
}

/** The text the scorer reads for one notice. */
export const rfpText = (it: RfpItem) =>
  [
    `Title: ${it.title}`,
    `Agency: ${it.agency || "(not stated)"}`,
    `Notice type: ${it.type || "(not stated)"}`,
    `NAICS: ${it.naics || "(not stated)"}`,
    `Set-aside: ${it.setAside || "None"}`,
    `Place of performance: ${it.place || "(not stated)"}`,
    `Response due: ${it.due ?? "(not stated)"}`,
    `Value: ${it.value ? `$${it.value.toLocaleString("en-US")}` : "(not posted)"}`,
  ].join("\n");
