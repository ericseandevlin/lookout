import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { parseMoney } from "@/lib/kinds";
import { fetchPage, FetchError, pageToText } from "@/lib/ai/fetchPage";
import { findPay, type Pay } from "@/lib/ai/pay";
import type { RunReport, RunTally, SearchProfile } from "@/lib/db/schema";
import { ensureSearchProfile, loadRawInputs, renderSearchProfile } from "./searchProfile";
import { buildTips, emptyTally } from "./report";
import { autoQueue } from "@/lib/apply";
import { completeJSON, emptyUsage, type Usage } from "@/lib/ai/llm";
import { assertBudget, finishRun, progress, startRun } from "@/lib/ai/runs";
import { webSearch, type SearchHit } from "@/lib/ai/search";
import { getAiConfig } from "@/lib/config";
import { applyRules, fingerprint, normUrl } from "./rules";
import { closeGonePostings } from "./linkCheck";
import { findEventsIfDue } from "./networking";
import { featureOn } from "@/lib/features";
import { discoverRfp } from "./rfp";

/**
 * Discovery pipeline, built to work with small, cheap models:
 *  1. the model writes search queries from the profile
 *  2. we run them against the search backend and dedupe
 *  3. the model picks the hits that look like real, single postings
 *  4. we fetch those pages ourselves (SSRF-safe) and extract text + JobPosting data
 *  5. the model scores them a few at a time; hard rules run on top
 */

const MAX_QUERIES = 6;
const MAX_PICKS = 15;
const BATCH = 4;

export type Context = {
  /** The search being run (#8); its kind decides what the queries hunt for. */
  searchId: string;
  /** The search's kind id ("job", "rfp"); report tips word themselves by it (#300). */
  kind: string;
  userId: string;
  brief: string;
  resume: string;
  /** Text of the profile PDF from LinkedIn's Save to PDF, if uploaded. */
  linkedin: string;
  /** Text read from the user's other links (portfolio, site, writing). */
  links: { url: string; text: string }[];
  /** The saved search profile; when present it stands in for the raw materials. */
  searchProfile: SearchProfile | null;
  /** Recent "Not a fit" calls, so searches stop suggesting the same kind of role. */
  rejected: string[];
  floor: number | null;
  knownUrls: string[];
  answers: Record<string, string | string[]>;
  hasResume: boolean;
};

export async function loadContext(searchId: string): Promise<Context> {
  const raw = await loadRawInputs(searchId);
  const userId = raw.stored!.userId;
  const rows = await db
    .select({ url: schema.opportunities.sourceUrl, title: schema.opportunities.title, company: schema.opportunities.company, feedback: schema.userOpportunities.feedback })
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(eq(schema.userOpportunities.searchId, searchId));
  const rejected = rows
    .filter((r) => r.feedback)
    .sort((a, b) => (b.feedback!.at > a.feedback!.at ? 1 : -1))
    .slice(0, 12)
    .map((r) => `${r.title} at ${r.company}: ${r.feedback!.reason}`);
  return {
    searchId,
    kind: raw.stored!.kind,
    userId,
    brief: raw.brief,
    resume: raw.resume,
    linkedin: raw.linkedin,
    links: raw.links,
    searchProfile: raw.stored?.searchProfile ?? null,
    rejected,
    floor: parseMoney(raw.answers.floor),
    knownUrls: rows.map((k) => k.url).filter((u): u is string => !!u),
    answers: raw.answers,
    hasResume: raw.sources.resume || raw.sources.linkedin,
  };
}

export const profileBlock = (c: Context) =>
  `<profile>\n${c.brief}\n</profile>\n` +
  (c.searchProfile
    ? `<search_profile>\n${renderSearchProfile(c.searchProfile)}\n</search_profile>`
    : `<resume>\n${c.resume || "(no resume uploaded)"}\n</resume>` +
      (c.linkedin ? `\n<linkedin_profile>\n${c.linkedin}\n</linkedin_profile>` : "") +
      (c.links.length ? `\n<their_links>\n${c.links.map((l) => `${l.url}\n${l.text}`).join("\n---\n")}\n</their_links>` : "")) +
  (c.rejected.length ? `\n<marked_not_a_fit>\nThey said these roles were not a fit. Avoid similar ones.\n${c.rejected.join("\n")}\n</marked_not_a_fit>` : "");

const today = () => new Date().toISOString().slice(0, 10);

// --- 1. queries --------------------------------------------------------------

const Queries = z.object({ queries: z.array(z.string()).describe("4 to 6 web search queries") });

async function makeQueries(ctx: Context, usage: Usage) {
  const out = await completeJSON({
    name: "queries",
    schema: Queries,
    usage,
    maxTokens: 1000,
    system: "You write web search queries that surface currently open job postings for one candidate.",
    user: `${profileBlock(ctx)}

Write 4 to 6 search queries for open roles that fit. Mix:
- plain queries a person would type, e.g. "Director of Events jobs New York"
- queries aimed at employer job pages, e.g. "Director of Events" New York site:greenhouse.io OR site:lever.co OR site:myworkdayjobs.com OR site:ashbyhq.com
Use the candidate's target titles, close variants, and their city. Keep each under 120 characters.`,
  });
  const queries = out.queries.map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUERIES);
  if (queries.length) return queries;
  // No usable queries from the model: search the profile's target titles instead (#609).
  const titles = (ctx.searchProfile?.targetTitles ?? []).map((t) => t.trim()).filter(Boolean).slice(0, MAX_QUERIES);
  if (!titles.length) throw new Error("Couldn't plan any searches from your profile. Try again, or add target titles to your profile.");
  return titles.map((t) => `${t} jobs`);
}

// --- 2+3. search and pick ----------------------------------------------------

const AGGREGATOR = /(indeed|linkedin|glassdoor|ziprecruiter|simplyhired|monster|careerbuilder)\.com\/(jobs|q-|m\/jobs)|\/search\?|\/jobs\/?$/i;

type Report = (pct: number, step: string) => Promise<void>;

async function gatherHits(ctx: Context, queries: string[], usage: Usage, report: Report) {
  const known = new Set(ctx.knownUrls.map(normUrl));
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  const results: PromiseSettledResult<SearchHit[]>[] = [];
  for (const [i, q] of queries.entries()) {
    await report(10 + (25 * i) / queries.length, `Searching “${q}”`);
    results.push(await webSearch(q, usage).then((value) => ({ status: "fulfilled" as const, value }), (reason) => ({ status: "rejected" as const, reason })));
  }
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const h of r.value) {
      const k = normUrl(h.url);
      if (seen.has(k) || known.has(k) || AGGREGATOR.test(h.url)) continue;
      seen.add(k);
      hits.push(h);
    }
  }
  if (!hits.length && results.length && results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  return hits.slice(0, 60);
}

const Picks = z.object({ picks: z.array(z.number().int()).describe("Indexes of the most promising single job postings") });

async function pickHits(ctx: Context, hits: SearchHit[], usage: Usage) {
  if (hits.length <= MAX_PICKS) return hits;
  const list = hits.map((h, i) => `[${i}] ${h.title}\n${h.url}\n${h.snippet.slice(0, 200)}`).join("\n\n");
  // A bad answer here shouldn't sink the whole search; fall back to the top results.
  const out = await completeJSON({
    name: "picks",
    schema: Picks,
    usage,
    maxTokens: 800,
    system: "You triage search results for a recruiter.",
    user: `${profileBlock(ctx)}\n\n<results>\n${list}\n</results>\n\nPick up to ${MAX_PICKS} results that are most likely a single, currently open job posting that fits this candidate. Skip list pages, articles, salary guides and expired posts. Return their indexes.`,
  }).catch((e) => {
    console.warn("[discover] picks failed, using top results", e instanceof Error ? e.message : e);
    return { picks: [] as number[] };
  });
  const chosen = [...new Set(out.picks)].filter((i) => i >= 0 && i < hits.length).map((i) => hits[i]);
  return chosen.length ? chosen.slice(0, MAX_PICKS) : hits.slice(0, MAX_PICKS);
}

// --- 4. fetch ------------------------------------------------------------------

type Page = { url: string; text: string; pay: Pay | null };

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

async function fetchAll(urls: string[], report?: Report): Promise<Page[]> {
  const out: Page[] = [];
  const queue = [...urls];
  let done = 0;
  const worker = async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      await report?.(40 + (35 * done) / urls.length, `Reading ${host(u)}`);
      done++;
      try {
        const { url, html } = await fetchPage(u);
        const text = pageToText(html, 7000);
        if (text.length > 300) out.push({ url, text, pay: findPay(html) });
      } catch (e) {
        // Dead, blocked or non-HTML pages are skipped, but logged so a broken reader shows up.
        console.warn(`[fetch] ${host(u)}: ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : e}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}

// --- 5. score ------------------------------------------------------------------

const Scored = z.object({
  index: z.number().int().describe("The [n] of the page this entry is about"),
  is_open_job_posting: z.boolean().describe("True only if the page is one specific job that still looks open"),
  company: z.string(),
  title: z.string(),
  location: z.string().describe("City and state, plus (on-site), (hybrid) or (remote) when known"),
  work_mode: z.enum(["On-site", "Hybrid", "Remote", "Unknown"]),
  comp_min: z.number().nullable().describe("Annual base salary low end in USD, null if not posted"),
  comp_max: z.number().nullable().describe("Annual base salary high end in USD, null if not posted"),
  posted_at: z.string().nullable().describe("YYYY-MM-DD the posting went up, null if unknown"),
  description: z.string().describe("Two plain sentences on the role"),
  score: z.number().int().min(1).max(5).describe("Fit: 5 = bullseye, 4 = strong with one gap, 3 = sideways, 2 = weak, 1 = poor"),
  reasons_match: z.array(z.string()).describe("Up to 4 short, specific reasons it fits, addressed to the candidate as 'you'"),
  reasons_gap: z.array(z.string()).describe("Up to 3 short, specific reasons it may not fit"),
  location_fit: z.boolean().describe("True if location and work mode fit the stated preferences (or none were given)"),
  dealbreaker: z.boolean().describe("True only if it clearly hits something the candidate ruled out"),
});
export const ScoredList = z.object({ finds: z.array(Scored) });
export type ScoredT = z.infer<typeof Scored> & { url: string };

// Built per call: the server runs for days between deploys, and the date decides what still looks open (#608).
const scorerSystem = () => `You score job postings for one candidate. Today is ${today()}.
Only use facts on the page. Never invent pay or dates; use null when the page doesn't state them. Annualize hourly pay only if it is clearly full time.
Reasons are read on a phone: short, concrete, no filler.`;

async function scorePages(ctx: Context, pages: Page[], usage: Usage, report?: Report): Promise<ScoredT[]> {
  const out: ScoredT[] = [];
  const batches = Math.ceil(pages.length / BATCH);
  for (let i = 0; i < pages.length; i += BATCH) {
    const batch = pages.slice(i, i + BATCH);
    const n = i / BATCH + 1;
    await report?.(75 + (20 * (n - 1)) / Math.max(1, batches), `Scoring ${batch.length === 1 ? "the posting" : `postings ${i + 1} to ${i + batch.length}`} against your profile`);
    const body = batch.map((p, j) => `[${j}] URL: ${p.url}\n${p.text}`).join("\n\n=====\n\n");
    try {
      const res = await completeJSON({
        name: "score",
        schema: ScoredList,
        usage,
        maxTokens: 4000,
        system: scorerSystem(),
        user: `${profileBlock(ctx)}\n\n<pages>\n${body}\n</pages>\n\nReturn one entry per page, using its [n] as index.`,
      });
      for (const f of res.finds) {
        const page = batch[f.index];
        // The model sometimes misses pay even when it's on the page; the deterministic read fills the gap.
        if (page) out.push({ ...f, url: page.url, ...(f.comp_min == null && f.comp_max == null && page.pay && page.pay.currency === "USD" && { comp_min: page.pay.min, comp_max: page.pay.max }) });
      }
    } catch (e) {
      console.error("[discover] scoring batch failed", e);
    }
  }
  return out;
}

// --- save ----------------------------------------------------------------------

export async function save(ctx: Context, finds: ScoredT[], via: "agent" | "manual"): Promise<RunTally & { newFinds: { id: string; score: number }[] }> {
  const known = new Set(ctx.knownUrls.map(normUrl));
  const t = emptyTally();
  const newFinds: { id: string; score: number }[] = [];
  for (const f of finds) {
    if (!f.is_open_job_posting || !f.company || !f.title) {
      t.notPostings++;
      continue;
    }
    t.postings++;
    if (via === "agent" && known.has(normUrl(f.url))) {
      t.known++;
      continue;
    }
    const ruled = applyRules(
      {
        score: f.score,
        reasonsMatch: f.reasons_match,
        reasonsGap: f.reasons_gap,
        locationFit: f.location_fit,
        dealbreaker: via === "manual" ? false : f.dealbreaker,
        compMin: f.comp_min,
        compMax: f.comp_max,
      },
      ctx.floor,
    );
    if (!ruled) {
      t.dealbreaker++;
      continue;
    }
    const top = f.comp_max ?? f.comp_min;
    if (ctx.floor && top && top < ctx.floor) t.belowFloor++;
    if (!f.location_fit) t.offLocation++;
    const posted = f.posted_at && /^\d{4}-\d{2}-\d{2}$/.test(f.posted_at) ? f.posted_at : null;
    const [opp] = await db
      .insert(schema.opportunities)
      .values({
        type: "job",
        company: f.company.slice(0, 200),
        title: f.title.slice(0, 300),
        location: f.location.slice(0, 200),
        workMode: f.work_mode === "Unknown" ? null : f.work_mode,
        compMin: f.comp_min ? Math.round(f.comp_min) : null,
        compMax: f.comp_max ? Math.round(f.comp_max) : null,
        postedAt: posted,
        sourceUrl: f.url.slice(0, 1000),
        description: f.description.slice(0, 2000),
        fingerprint: fingerprint(f.company, f.title, f.location),
      })
      // The row is shared by everyone who has this find: keep its link and summary, only fill what's missing (#585).
      .onConflictDoUpdate({
        target: schema.opportunities.fingerprint,
        set: {
          sourceUrl: sql`coalesce(${schema.opportunities.sourceUrl}, excluded.source_url)`,
          description: sql`coalesce(nullif(${schema.opportunities.description}, ''), excluded.description)`,
        },
      })
      .returning();
    const inserted = await db
      .insert(schema.userOpportunities)
      .values({
        userId: ctx.userId,
        searchId: ctx.searchId,
        opportunityId: opp.id,
        score: ruled.score,
        reasonsMatch: ruled.reasonsMatch,
        reasonsGap: ruled.reasonsGap,
        addedVia: via,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) {
      t.added++;
      newFinds.push({ id: opp.id, score: ruled.score });
    }
    else t.known++;
    known.add(normUrl(f.url));
  }
  return { ...t, newFinds };
}

/** The funnel, queries and tips shown after a search. */
export function makeReport(ctx: Context, r: Omit<RunReport, "tips">): RunReport {
  const floor = typeof ctx.answers.floor === "string" ? ctx.answers.floor.trim() : "";
  return { ...r, tips: buildTips(r, { answers: ctx.answers, hasResume: ctx.hasResume, floor, kind: ctx.kind }) };
}

// --- entry points ----------------------------------------------------------------

/** The search row a run belongs to (#8): every run is for one of the account's searches. */
async function searchOf(searchId: string) {
  const [s] = await db.select().from(schema.searches).where(eq(schema.searches.id, searchId));
  if (!s) throw new Error("Search not found");
  return s;
}

/** Scheduled (or "Search now") discovery for one search (#8). */
export async function discover(searchId: string, trigger: "scheduled" | "manual" = "scheduled") {
  const search = await searchOf(searchId);
  // RFP searches read SAM.gov's API instead of the web (#272).
  if (search.kind === "rfp") return discoverRfp(searchId, search.userId, trigger);
  if ((await getAiConfig()).provider === "agent") {
    const run = await startRun(search.userId, trigger, { searchId, status: "queued", request: { type: "discover", searchId } });
    await progress(run.id, 0, "Queued. Waiting for the search agent to pick this up");
    return { found: 0, added: 0, queued: true };
  }
  await assertBudget(search.userId);
  const run = await startRun(search.userId, trigger, { searchId });
  const usage = emptyUsage();
  try {
    const report: Report = (pct, step) => progress(run.id, pct, step);
    await report(3, "Reading your profile and materials");
    const ctx = await loadContext(searchId);
    const sp = await ensureSearchProfile(searchId, usage);
    if (sp.rebuilt) await report(5, "Updated your search profile from your latest changes");
    ctx.searchProfile = sp.profile;
    await report(6, "Planning searches");
    const queries = await makeQueries(ctx, usage);
    const hits = await gatherHits(ctx, queries, usage, report);
    await report(37, `Found ${hits.length} new results. Picking the most promising`);
    const picks = await pickHits(ctx, hits, usage);
    const pages = await fetchAll(picks.map((h) => h.url), report);
    await report(75, `Read ${pages.length} postings`);
    const scored = await scorePages(ctx, pages, usage, report);
    await report(97, "Saving new finds");
    const { newFinds, ...tally } = await save(ctx, scored, "agent");
    const { added, postings: found } = tally;
    await autoQueue(search.userId, newFinds).catch((e) => console.error("[auto-apply] queue failed", e));
    await report(98, "Checking that your open finds are still posted");
    tally.closed = await closeGonePostings(search.userId).catch((e) => (console.error("[links] check failed", e), 0));
    // Networking events (#7): only for people who set event interests, on their weekly or monthly schedule (#265); never fails the job search.
    const events = !featureOn("EVENTS") ? null : await findEventsIfDue(ctx, usage, (step) => report(99, step)).catch((e) => (console.error("[events] failed", e), null));
    const eventsNote = events ? `, plus ${events} ${events === 1 ? "event" : "events"}` : "";
    await progress(run.id, 100, (added ? `Added ${added} new ${added === 1 ? "find" : "finds"}` : found ? "No new finds this time. Everything matching is already on your board" : "No matching open roles this time") + eventsNote);
    const summary = makeReport(ctx, { queries, results: hits.length, picked: picks.length, read: pages.length, tally });
    await finishRun(run.id, usage, { found, added, report: summary });
    return { found, added, runId: run.id };
  } catch (e) {
    await finishRun(run.id, usage, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Manual add: read one posting by URL, score it, add it to the search's board (#8). */
export async function addByUrl(searchId: string, url: string) {
  const search = await searchOf(searchId);
  const userId = search.userId;
  if ((await getAiConfig()).provider === "agent") {
    const run = await startRun(userId, "url", { searchId, status: "queued", request: { type: "url", url } });
    await progress(run.id, 0, "Queued. Waiting for the search agent to read the posting");
    return { added: 0, queued: true };
  }
  await assertBudget(userId);
  const run = await startRun(userId, "url", { searchId });
  const usage = emptyUsage();
  try {
    await progress(run.id, 10, `Opening ${host(url)}`);
    const ctx = await loadContext(searchId);
    let page: Page;
    try {
      const { url: finalUrl, html } = await fetchPage(url);
      page = { url: finalUrl, text: pageToText(html, 12000), pay: findPay(html) };
    } catch (e) {
      throw new Error(e instanceof FetchError ? e.message : "Couldn't load that page");
    }
    await progress(run.id, 45, "Reading the posting and scoring it against your profile");
    const scored = await scorePages(ctx, [page], usage);
    const one = scored.slice(0, 1).map((s) => ({ ...s, url, is_open_job_posting: s.is_open_job_posting || !!s.title }));
    const { added } = await save(ctx, one, "manual");
    if (one.length) await progress(run.id, 100, added ? `Added ${one[0].title} at ${one[0].company}` : "That posting is already on your board");
    await finishRun(run.id, usage, { found: one.length, added, error: one.length ? null : "That page didn't look like a job posting" });
    return { added };
  } catch (e) {
    await finishRun(run.id, usage, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export async function isRunning(userId: string) {
  const r = await db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.userId, userId), inArray(schema.runs.status, ["queued", "running"])))
    .limit(1);
  return r.length > 0;
}
