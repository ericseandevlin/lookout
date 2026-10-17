import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import { fetch } from "undici";
import { db, schema } from "@/lib/db";
import type { ApplicationReport, ApplicationStatus } from "@/lib/db/schema";
import { completeJSON, emptyUsage, type Usage } from "@/lib/ai/llm";
import { assertBudget } from "@/lib/ai/runs";
import { fetchPage, pageToText } from "@/lib/ai/fetchPage";
import { kinds } from "@/lib/kinds";
import {
  ANSWERS_SYSTEM,
  AnswersDraft,
  RESUME_SYSTEM,
  ResumeDraft,
  answersPrompt,
  checkAnswer,
  fillField,
  linkedinUrl,
  keywordReport,
  newNumbers,
  resumeNote,
  resumePrompt,
  type DraftInputs,
  type DraftItem,
  type Drafted,
} from "./draft";
import { ASHBY_QUERY, PAGE_SYSTEM, PageItems, applyUrlFor, boardFromHtml, boardGuesses, detectAts, fromPage, parseAshby, parseGreenhouse, routeFor, withBasics, type ScanResult } from "./scan";

/**
 * The auto-apply pipeline for one application: queued -> scanning -> (drafting) -> needs_review.
 * Runs in the app process, started right after queuing and swept by the scheduler for anything left behind.
 */

async function ghJob(board: string, id: string) {
  const { html } = await fetchPage(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}?questions=true`);
  return JSON.parse(html) as unknown;
}

/** A company page with ?gh_jid=: find its board on the page, else try the obvious names. */
async function ghEmbedOrJob(board: string, id: string, postingUrl: string) {
  if (board) return ghJob(board, id);
  const found = boardFromHtml((await fetchPage(postingUrl)).html);
  for (const b of found ? [found] : boardGuesses(new URL(postingUrl).hostname)) {
    try {
      return await ghJob(b, id);
    } catch {
      // try the next guess
    }
  }
  throw new Error("Couldn't find this company's Greenhouse board");
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
    if (ref.ats === "greenhouse") return { ats: ref.ats, route, applyUrl, source: "form", ...parseGreenhouse(await ghEmbedOrJob(ref.board, ref.id, postingUrl)) };
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
    await setStatus(id, "drafting", report);

    await assertBudget(app.userId);
    Object.assign(report, await draftAll(id, app.userId, opp, usage, scan.postingHtml));
    report.draftedAt = new Date().toISOString();
    report.usd = (report.usd ?? 0) + usage.usd;
    await setStatus(id, "needs_review", report);
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    report.usd = (report.usd ?? 0) + usage.usd;
    console.error(`[apply] ${id} failed`, e);
    await setStatus(id, "failed", report);
  }
}

/** Everything the drafts may draw on. The posting is re-read in full; the stored description is a summary. */
async function loadInputs(userId: string, opp: typeof schema.opportunities.$inferSelect, postingHtml?: string): Promise<DraftInputs> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const mats = await db.select().from(schema.materials).where(eq(schema.materials.userId, userId));
  const resume = mats.find((m) => m.kind === "resume")?.extracted?.text?.trim() ?? "";
  if (!resume) throw new Error("Add your resume on your profile first. Lookout drafts from it.");
  const li = mats.find((m) => m.kind === "linkedin");
  let text = opp.description;
  if (postingHtml) text = pageToText(postingHtml, 12000);
  else
    try {
      text = pageToText((await fetchPage(opp.sourceUrl!)).html, 12000);
    } catch {
      // Keep the stored description; a posting that won't load still has its summary.
    }
  return {
    name: user?.name ?? "",
    email: user?.email ?? "",
    linkedinUrl: li?.url ? linkedinUrl(li.url) : null,
    links: mats.filter((m) => m.kind === "link" && m.url).map((m) => ({ url: m.url!, text: m.extracted?.text ?? "" })),
    brief: kinds[profile?.kind ?? "job"]?.brief(profile?.answers ?? {}) ?? "",
    resume: resume.slice(0, 20000),
    posting: { company: opp.company, title: opp.title, text },
  };
}

/** Draft version 1 of every item. Returns the resume's keyword report and the posting text it drafted from. */
async function draftAll(id: string, userId: string, opp: typeof schema.opportunities.$inferSelect, usage: Usage, postingHtml?: string) {
  const inp = await loadInputs(userId, opp, postingHtml);
  const items = await db.select().from(schema.applicationItems).where(eq(schema.applicationItems.applicationId, id)).orderBy(schema.applicationItems.position);
  const out = new Map<string, Drafted>();
  let keywords: ReturnType<typeof keywordReport> | undefined;

  const resumeItem = items.find((i) => i.kind === "resume");
  if (resumeItem) {
    const d = await completeJSON({ name: "apply-resume", schema: ResumeDraft, system: RESUME_SYSTEM, user: resumePrompt(inp), maxTokens: 8000, usage });
    keywords = keywordReport(inp.resume, d.resume, d);
    out.set(resumeItem.id, { content: d.resume.trim(), note: resumeNote(keywords, d, newNumbers(inp.resume, d.resume)), sources: ["master resume", "posting"], question: null });
  }

  const rest: (DraftItem & { id: string })[] = [];
  for (const [index, it] of items.entries()) {
    if (it.kind === "resume") continue;
    const fact = it.kind === "field" ? fillField(it.prompt, inp) : null;
    if (fact) out.set(it.id, fact);
    else rest.push({ id: it.id, index, kind: it.kind, prompt: it.prompt, required: it.required, options: it.options });
  }
  if (rest.length) {
    const r = await completeJSON({ name: "apply-answers", schema: AnswersDraft, system: ANSWERS_SYSTEM, user: answersPrompt(inp, rest), maxTokens: 8000, usage });
    const byIndex = new Map(r.items.map((a) => [a.index, a]));
    for (const it of rest) out.set(it.id, checkAnswer(it, byIndex.get(it.index)));
  }

  await db.transaction(async (tx) => {
    for (const it of items) {
      const d = out.get(it.id);
      if (!d) continue;
      await tx.delete(schema.itemVersions).where(eq(schema.itemVersions.itemId, it.id));
      await tx.insert(schema.itemVersions).values({ itemId: it.id, version: 1, content: d.content, note: d.note, author: "ai", sources: d.sources });
      await tx.update(schema.applicationItems).set({ question: d.question, approvedVersionId: null }).where(eq(schema.applicationItems.id, it.id));
    }
  });
  return { keywords, postingText: inp.posting.text };
}

/** Re-queue work a restart interrupted, then return what's waiting. One user, or everyone. */
async function leftovers(userId?: string) {
  const stale = new Date(Date.now() - 30 * 60_000);
  const mine = userId ? [eq(schema.applications.userId, userId)] : [];
  await db
    .update(schema.applications)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(inArray(schema.applications.status, ["scanning", "drafting"]), lt(schema.applications.updatedAt, stale), ...mine));
  return db.select({ id: schema.applications.id }).from(schema.applications).where(and(eq(schema.applications.status, "queued"), ...mine)).limit(10);
}

/** Scheduler sweep: start anything queued, and re-queue work a restart interrupted. */
export async function sweepApplications() {
  for (const { id } of await leftovers()) await processApplication(id);
}

/** Opening /apply resumes the user's own leftovers, so nothing waits on the scheduler (which staging runs without). */
export async function resumeFor(userId: string) {
  for (const { id } of await leftovers(userId)) kick(id);
}

/** Start one right away (fire and forget); the scheduler catches it if this process dies. */
export function kick(id: string) {
  void processApplication(id).catch((e) => console.error("[apply] kick", e));
}
