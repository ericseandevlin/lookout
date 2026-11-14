import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchPage, FetchError, pageToText } from "@/lib/ai/fetchPage";
import { ashbyOrgFromHtml, boardFromHtml, boardGuesses, detectAts } from "@/lib/application/scan";
import { classifyPage, closedNote, type LinkState } from "./linkState";
import { env } from "@/lib/env";
import { dayKey } from "@/lib/spend";

/** Stored on opportunities.attributes so every person's board shares one check per posting. */
type LinkCheck = { checkedAt: string; state: LinkState; reason: string; goneSince?: string };

const CONFIRM_MS = 20 * 3600_000; // gone on two checks at least this far apart before anything closes
// Only these close. Finds they're pursuing (Applied, Interview, Offer) or already passed on (Nope) are never checked.
const CLOSABLE = ["Not applied", "Auto-applying", "Ghosted", "Not selected"];

const LD_JSON = /<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi;

// Some careers sites answer inconsistently (one server in maintenance, the next with the real page), so an
// inconclusive answer is retried a few times before it counts as unknown.
async function check(url: string): Promise<{ state: LinkState; reason: string }> {
  let last = await checkOnce(url);
  for (let i = 1; i < 3 && last.state === "unknown"; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    last = await checkOnce(url);
  }
  return last;
}

async function checkOnce(url: string): Promise<{ state: LinkState; reason: string }> {
  try {
    const { url: finalUrl, html } = await fetchPage(url);
    // The visible page only: pageToText puts JobPosting data first, and a long description there pushed a closed
    // posting's "no longer available" past the part classifyPage reads (#1026).
    const page = classifyPage(200, pageToText(html.replace(LD_JSON, " "), 4000), finalUrl);
    return page.state === "open" ? ((await embedVerdict(url, html)) ?? page) : page;
  } catch (e) {
    const status = statusOf(e);
    return Number.isFinite(status) ? classifyPage(status, "") : { state: "unknown", reason: "couldn't reach it" };
  }
}

const statusOf = (e: unknown) => (e instanceof FetchError ? Number(e.message.match(/answered (\d{3})/)?.[1]) : NaN);

/** True when the URL answers, false on a 404, null when it says nothing either way. */
async function answers(url: string): Promise<boolean | null> {
  try {
    await fetchPage(url);
    return true;
  } catch (e) {
    return statusOf(e) === 404 ? false : null;
  }
}

async function ashbyJobExists(org: string, id: string): Promise<boolean | null> {
  try {
    // Fixed public host, so the plain client is fine (fetchPage only does GET).
    const res = await fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (compatible; LookoutBot/1.0)" },
      body: JSON.stringify({
        operationName: "ApiJobPosting",
        variables: { organizationHostedJobsPageName: org, jobPostingId: id },
        query: "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { id } }",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { jobPosting?: unknown } };
    return body.data && "jobPosting" in body.data ? !!body.data.jobPosting : null;
  } catch {
    return null;
  }
}

/**
 * A company page that embeds Greenhouse (?gh_jid=) or Ashby (?ashby_jid=) stays up after the job closes, so ask the ATS (#678).
 * Gone only when the board the page names no longer has the job; a failed call keeps the page's verdict. A board guessed from the
 * host can only confirm the job is open: a board by that name may belong to another company, so a miss there proves nothing,
 * and the next guess still gets its turn (#1046).
 */
async function embedVerdict(url: string, html: string): Promise<{ state: LinkState; reason: string } | null> {
  const ref = detectAts(url);
  const host = new URL(url).hostname;
  if (ref.ats === "greenhouse" && !ref.board) {
    const found = boardFromHtml(html);
    // A greenhouse.io host says nothing about the company, so there is nothing to guess (#674).
    const boards = found ? [found] : /(^|\.)greenhouse\.io$/i.test(host) ? [] : boardGuesses(host);
    for (const b of boards) {
      const api = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b)}`;
      if ((await answers(api)) !== true) continue;
      const job = await answers(`${api}/jobs/${ref.id}`);
      if (found) return job === false ? { state: "gone", reason: "Greenhouse no longer lists the job" } : null;
      if (job === true) return null;
    }
  }
  if (ref.ats === "ashby" && !ref.org) {
    const found = ashbyOrgFromHtml(html);
    for (const o of found ? [found] : boardGuesses(host)) {
      if ((await answers(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(o)}`)) !== true) continue;
      const job = await ashbyJobExists(o, ref.id);
      if (found) return job === false ? { state: "gone", reason: "Ashby no longer lists the job" } : null;
      if (job === true) return null;
    }
  }
  return null;
}

/**
 * Re-checks the person's open finds and closes postings that are confirmed gone: stage Closed, archived, and a note
 * with the date it was first seen gone. Finds they're actively pursuing or passed on are never touched. Returns how many closed.
 */
export async function closeGonePostings(userId: string, now = new Date()): Promise<number> {
  const rows = await db
    .select({ uo: schema.userOpportunities, o: schema.opportunities })
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(and(eq(schema.userOpportunities.userId, userId), eq(schema.userOpportunities.archived, false)));
  // One check per posting: the same posting on two of their searches is two rows here (#656).
  const open = [...new Map(rows.filter((r) => r.o.sourceUrl && CLOSABLE.includes(r.uo.stage)).map((r) => [r.o.id, r])).values()];

  let closed = 0;
  const queue = [...open];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const prev = (r.o.attributes?.linkCheck ?? null) as LinkCheck | null;
      // Checked on every search run.
      const { state, reason } = await check(r.o.sourceUrl!);
      // goneSince starts at the first gone result and survives "unknown" (a maintenance page proves nothing); an open result clears it.
      const goneSince = state === "gone" ? (prev?.goneSince ?? now.toISOString()) : state === "open" ? undefined : prev?.goneSince;
      const lc: LinkCheck = { checkedAt: now.toISOString(), state, reason, ...(goneSince && { goneSince }) };
      // Only the link check, and only while the posting still has the link checked: another run may have saved a
      // repost at a new link meanwhile (#830), and writing the old verdict back would close a live job (#1034).
      const attrs = schema.opportunities.attributes;
      const wrote = await db
        .update(schema.opportunities)
        .set({ attributes: sql`jsonb_set(coalesce(${attrs}, '{}'::jsonb), '{linkCheck}', ${JSON.stringify(lc)}::jsonb)` })
        .where(and(eq(schema.opportunities.id, r.o.id), eq(schema.opportunities.sourceUrl, r.o.sourceUrl!)))
        .returning({ id: schema.opportunities.id });
      if (!wrote.length) continue;
      if (lc.state === "gone" && lc.goneSince && now.getTime() - Date.parse(lc.goneSince) >= CONFIRM_MS) {
        // The day in the app's zone: the UTC date ran a day late for a check after 7 or 8pm in New York (#1223).
        const day = dayKey(new Date(lc.goneSince), env.timezone);
        const line = closedNote(lc.reason, day);
        // The stage may have moved since the read (they applied mid-run); count only a find this actually closed (#614).
        // The line goes onto each row's notes as they are now, so a note typed during the run survives (#656).
        const notes = schema.userOpportunities.notes;
        const done = await db
          .update(schema.userOpportunities)
          .set({ stage: "Closed", archived: true, notes: sql`case when ${notes} ~ '\\S' then regexp_replace(${notes}, '\\s+$', '') || ${`\n\n${line}`} else ${line} end` })
          .where(and(eq(schema.userOpportunities.userId, userId), eq(schema.userOpportunities.opportunityId, r.o.id), inArray(schema.userOpportunities.stage, CLOSABLE)))
          .returning({ stage: schema.userOpportunities.stage });
        if (done.length) {
          closed++;
          // An application still waiting to start would read and draft a posting that is gone (#827). Anything further along is theirs to decide.
          await db
            .update(schema.applications)
            .set({ status: "canceled", updatedAt: new Date() })
            .where(and(eq(schema.applications.userId, userId), eq(schema.applications.opportunityId, r.o.id), eq(schema.applications.status, "queued")));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return closed;
}
