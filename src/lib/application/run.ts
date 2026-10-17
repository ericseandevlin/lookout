import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import { fetch } from "undici";
import { db, schema } from "@/lib/db";
import type { ApplicationReport, ApplicationStatus } from "@/lib/db/schema";
import { completeJSON, emptyUsage, type Usage } from "@/lib/ai/llm";
import { assertBudget } from "@/lib/ai/runs";
import { fetchPage, pageToText } from "@/lib/ai/fetchPage";
import { ASHBY_QUERY, PAGE_SYSTEM, PageItems, applyUrlFor, detectAts, fromPage, parseAshby, parseGreenhouse, routeFor, withBasics, type ScanResult } from "./scan";

/**
 * The auto-apply pipeline for one application: queued -> scanning -> (drafting) -> needs_review.
 * Runs in the app process, started right after queuing and swept by the scheduler for anything left behind.
 */

async function ghJob(board: string, id: string) {
  const { html } = await fetchPage(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}?questions=true`);
  return JSON.parse(html) as unknown;
}

async function ashbyForm(org: string, id: string) {
  // Fixed public host, so the plain client is fine (fetchPage only does GET).
  const res = await fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (compatible; LookoutBot/1.0)" },
    body: JSON.stringify({ operationName: "ApiJobPosting", variables: { organizationHostedJobsPageName: org, jobPostingId: id }, query: ASHBY_QUERY }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Ashby answered ${res.status}`);
  return (await res.json()) as unknown;
}

/** Read the application. Published forms first; the model reads the page only when there is no form to fetch. */
export async function scanPosting(postingUrl: string, usage: Usage): Promise<ScanResult> {
  const ref = detectAts(postingUrl);
  const applyUrl = applyUrlFor(ref, postingUrl);
  const route = routeFor(ref.ats);
  try {
    if (ref.ats === "greenhouse") return { ats: ref.ats, route, applyUrl, source: "form", ...parseGreenhouse(await ghJob(ref.board, ref.id)) };
    if (ref.ats === "ashby") return { ats: ref.ats, route, applyUrl, source: "form", ...parseAshby(await ashbyForm(ref.org, ref.id)) };
  } catch (e) {
    // A closed posting is final; anything else (API change, outage) falls back to reading the page.
    if (e instanceof Error && /answered 404/.test(e.message)) throw new Error("This posting is closed: the job board no longer lists it.");
    if (e instanceof Error && /closed|doesn't exist/.test(e.message)) throw e;
    console.error(`[apply] ${ref.ats} form read failed, reading the page`, e);
  }
  const { html } = await fetchPage(applyUrl);
  const r = await completeJSON({
    name: "apply-scan",
    schema: PageItems,
    system: PAGE_SYSTEM,
    user: `Apply page: ${applyUrl}\n\n<page>\n${pageToText(html, 14000)}\n</page>`,
    maxTokens: 4000,
    usage,
  });
  return { ats: ref.ats, route, applyUrl, source: "page", ...fromPage(r), ...(r.hasForm ? {} : { howToApply: r.howToApply }) } as ScanResult;
}

async function setStatus(id: string, status: ApplicationStatus, report?: ApplicationReport) {
  await db
    .update(schema.applications)
    .set({ status, updatedAt: new Date(), ...(report ? { report } : {}) })
    .where(eq(schema.applications.id, id));
}

/** Claim a queued application so two workers never run the same one. */
async function claim(id: string) {
  const [row] = await db
    .update(schema.applications)
    .set({ status: "scanning", updatedAt: new Date() })
    .where(and(eq(schema.applications.id, id), eq(schema.applications.status, "queued")))
    .returning();
  return row;
}

export async function processApplication(id: string) {
  const app = await claim(id);
  if (!app) return;
  const usage = emptyUsage();
  const report: ApplicationReport = { ...app.report, error: undefined };
  try {
    await assertBudget(app.userId);
    const [opp] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, app.opportunityId));
    if (!opp?.sourceUrl) throw new Error("This find has no posting link to read.");

    const scan = await scanPosting(opp.sourceUrl, usage);
    const items = withBasics(scan.items);
    await db.transaction(async (tx) => {
      await tx.delete(schema.applicationItems).where(eq(schema.applicationItems.applicationId, id));
      await tx.insert(schema.applicationItems).values(
        items.map((it, i) => ({ applicationId: id, kind: it.kind, prompt: it.prompt, required: it.required, position: i, fieldType: it.fieldType ?? null, options: it.options ?? null })),
      );
      await tx.update(schema.applications).set({ ats: scan.ats, route: scan.route }).where(eq(schema.applications.id, id));
    });
    Object.assign(report, { source: scan.source, applyUrl: scan.applyUrl, hasEeo: scan.hasEeo, howToApply: (scan as { howToApply?: string }).howToApply || undefined, scannedAt: new Date().toISOString() });
    report.usd = (report.usd ?? 0) + usage.usd;
    // Drafting (#40) picks up from here.
    await setStatus(id, "drafting", report);
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    report.usd = (report.usd ?? 0) + usage.usd;
    console.error(`[apply] ${id} failed`, e);
    await setStatus(id, "failed", report);
  }
}

/** Scheduler sweep: start anything queued, and re-queue work a restart interrupted. */
export async function sweepApplications() {
  const stale = new Date(Date.now() - 30 * 60_000);
  await db
    .update(schema.applications)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(schema.applications.status, "scanning"), lt(schema.applications.updatedAt, stale)));
  const queued = await db.select({ id: schema.applications.id }).from(schema.applications).where(inArray(schema.applications.status, ["queued"])).limit(10);
  for (const { id } of queued) await processApplication(id);
}

/** Start one right away (fire and forget); the scheduler catches it if this process dies. */
export function kick(id: string) {
  void processApplication(id).catch((e) => console.error("[apply] kick", e));
}
