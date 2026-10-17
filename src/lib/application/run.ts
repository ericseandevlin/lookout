import "server-only";
import { and, eq, inArray, lt, max } from "drizzle-orm";
import { fetch } from "undici";
import { db, schema } from "@/lib/db";
import type { ApplicationReport, ApplicationStatus } from "@/lib/db/schema";
import { completeJSON, emptyUsage, type Usage } from "@/lib/ai/llm";
import { assertBudget } from "@/lib/ai/runs";
import { fetchPage, pageToText } from "@/lib/ai/fetchPage";
import { kinds } from "@/lib/kinds";
import { humanize } from "./resumeLayout";
import { match, savedBlock } from "./saved";
import { findTraps, removeTraps, stripBoilerplate, stripHidden, trapWordsIn } from "./posting";
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
  if (board) return { board, job: await ghJob(board, id) };
  const found = boardFromHtml((await fetchPage(postingUrl)).html);
  for (const b of found ? [found] : boardGuesses(new URL(postingUrl).hostname)) {
    try {
      return { board: b, job: await ghJob(b, id) };
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
    if (ref.ats === "greenhouse") {
      const { board, job } = await ghEmbedOrJob(ref.board, ref.id, postingUrl);
      // Embedded boards live in an iframe on the company page; Greenhouse's own embed URL is the bare form.
      const url = ref.board ? applyUrl : `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${ref.id}`;
      return { ats: ref.ats, route, applyUrl: url, source: "form", ...parseGreenhouse(job) };
    }
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
    // Hidden text is for scrapers only; the model reads what a person sees (#116).
    user: `Apply page: ${applyUrl}\n\n<page>\n${pageToText(stripHidden(html).html, 14000)}\n</page>`,
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
  let hidden: string[] = [];
  let html = postingHtml;
  if (!html)
    try {
      html = (await fetchPage(opp.sourceUrl!)).html;
    } catch {
      // Keep the stored description; a posting that won't load still has its summary.
    }
  if (html) {
    // Text a person can't see is only there for scrapers; it never reaches a draft (#116).
    const v = stripHidden(html);
    hidden = v.hidden;
    text = pageToText(v.html, 12000);
  }
  // Company notices (fraud warnings, EEO, privacy) aren't the job; keep them out of every draft (#114).
  text = stripBoilerplate(text);
  // Instructions planted for applicants or AI ("include the word X") are cut and shown to the user instead (#116).
  const cleaned = removeTraps(text, hidden);
  text = cleaned.text;
  // Facts the description often leaves to the page around it.
  const pay = opp.compMin || opp.compMax ? `${[opp.compMin, opp.compMax].filter(Boolean).map((n) => `$${n!.toLocaleString("en-US")}`).join(" – ")} ${opp.currency}` : "";
  const facts = [`Role: ${opp.title}`, `Company: ${opp.company}`, opp.location && `Location: ${opp.location}`, opp.workMode && `Work mode: ${opp.workMode}`, pay && `Pay range on file: ${pay}`].filter(Boolean).join("\n");
  text = `${facts}\n\n${text}`;
  return {
    name: user?.name ?? "",
    email: user?.email ?? "",
    linkedinUrl: li?.url ? linkedinUrl(li.url) : null,
    links: mats.filter((m) => m.kind === "link" && m.url).map((m) => ({ url: m.url!, text: m.extracted?.text ?? "" })),
    brief: (kinds[profile?.kind ?? "job"]?.brief(profile?.answers ?? {}) ?? "") + savedBlock(profile?.applyAnswers ?? []),
    saved: profile?.applyAnswers ?? [],
    resume: resume.slice(0, 20000),
    posting: { company: opp.company, title: opp.title, text },
    traps: cleaned.traps,
  };
}

/** The ATS resume and its keyword report, from the person's master resume and the cleaned posting. */
async function draftResume(inp: DraftInputs, usage: Usage) {
  const d = await completeJSON({ name: "apply-resume", schema: ResumeDraft, system: RESUME_SYSTEM, user: resumePrompt(inp), maxTokens: 8000, usage });
  const keywords = keywordReport(inp.resume, d.resume, d, inp.posting.text);
  const draft: Drafted = { content: humanize(d.resume.trim()), note: resumeNote(keywords, d, newNumbers(inp.resume, d.resume)), sources: ["master resume", "posting"], question: null };
  const hits = trapWordsIn(draft.content, inp.traps ?? [], `${inp.resume}\n${inp.brief}`);
  if (hits.length) draft.question = `This draft includes ${hits.map((h) => `"${h}"`).join(", ")}, which the posting planted to catch automated applications. Remove it unless you mean to include it.`;
  return { draft, keywords };
}

/**
 * Write a fresh resume from the posting, as a new version: for drafts made before a fix, or when the
 * user wants to start that one over. Every other item and approval stays as it is.
 */
export async function redraftResume(appId: string) {
  const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, appId));
  const [item] = await db.select().from(schema.applicationItems).where(and(eq(schema.applicationItems.applicationId, appId), eq(schema.applicationItems.kind, "resume")));
  if (!a || !item) throw new Error("No resume on this application");
  await assertBudget(a.userId);
  const [opp] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, a.opportunityId));
  const usage = emptyUsage();
  let postingHtml: string | undefined;
  try {
    postingHtml = (await scanPosting(opp.sourceUrl!, usage)).postingHtml;
  } catch {
    // The posting page still works without the ATS's full description.
  }
  const inp = await loadInputs(a.userId, opp, postingHtml);
  const { draft, keywords } = await draftResume(inp, usage);
  await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: max(schema.itemVersions.version) }).from(schema.itemVersions).where(eq(schema.itemVersions.itemId, item.id));
    await tx.insert(schema.itemVersions).values({ itemId: item.id, version: (n ?? 0) + 1, content: draft.content, note: `Redrafted from the posting. ${draft.note}`, author: "ai", sources: draft.sources });
    await tx.update(schema.applicationItems).set({ approvedVersionId: null, question: draft.question }).where(eq(schema.applicationItems.id, item.id));
    const status = a.status === "approved" || a.status === "manual" ? "needs_review" : a.status;
    await tx
      .update(schema.applications)
      .set({ status, updatedAt: new Date(), report: { ...a.report, keywords, postingText: inp.posting.text, traps: inp.traps ?? [], usd: (a.report.usd ?? 0) + usage.usd } })
      .where(eq(schema.applications.id, appId));
  });
}

/** Draft version 1 of every item. Returns the resume's keyword report and the posting text it drafted from. */
async function draftAll(id: string, userId: string, opp: typeof schema.opportunities.$inferSelect, usage: Usage, postingHtml?: string) {
  const inp = await loadInputs(userId, opp, postingHtml);
  const items = await db.select().from(schema.applicationItems).where(eq(schema.applicationItems.applicationId, id)).orderBy(schema.applicationItems.position);
  const out = new Map<string, Drafted>();
  let keywords: ReturnType<typeof keywordReport> | undefined;

  const resumeItem = items.find((i) => i.kind === "resume");
  if (resumeItem) {
    const r = await draftResume(inp, usage);
    keywords = r.keywords;
    out.set(resumeItem.id, r.draft);
  }

  const rest: (DraftItem & { id: string })[] = [];
  for (const [index, it] of items.entries()) {
    if (it.kind === "resume") continue;
    // A form question aimed at automated tools goes to the person, never the model (#116).
    if (findTraps(it.prompt).length) {
      out.set(it.id, { content: "", note: "This question looks planted to catch automated applications, so Lookout left it to you.", sources: [], question: `Answer this one yourself: "${it.prompt.slice(0, 200)}"` });
      continue;
    }
    const savedHit = match(inp.saved ?? [], it.prompt, it.options);
    const fact = (it.kind === "field" ? fillField(it.prompt, inp) : null) ?? (savedHit ? { content: savedHit, note: "From your saved answers. Edit them on your profile.", sources: ["saved answer"], question: null } : null);
    if (fact) out.set(it.id, fact);
    else rest.push({ id: it.id, index, kind: it.kind, prompt: it.prompt, required: it.required, options: it.options });
  }
  if (rest.length) {
    const r = await completeJSON({ name: "apply-answers", schema: AnswersDraft, system: ANSWERS_SYSTEM, user: answersPrompt(inp, rest), maxTokens: 8000, usage });
    const byIndex = new Map(r.items.map((a) => [a.index, a]));
    for (const it of rest) {
      const a = checkAnswer(it, byIndex.get(it.index));
      // Choice answers must stay exactly as the form words them.
      out.set(it.id, it.options?.length ? a : { ...a, content: humanize(a.content) });
    }
  }

  // Last check: a trap word in any draft (and not in the person's own materials) sends it back to them.
  for (const [itemId, d] of out) {
    const hits = trapWordsIn(d.content, inp.traps ?? [], `${inp.resume}\n${inp.brief}`);
    if (hits.length) {
      d.note = `${d.note} Contains ${hits.map((h) => `"${h}"`).join(", ")} from an instruction planted in the posting.`.trim();
      d.question = `This draft includes ${hits.map((h) => `"${h}"`).join(", ")}, which the posting planted to catch automated applications. Remove it unless you mean to include it.`;
      out.set(itemId, d);
    }
  }

  await db.transaction(async (tx) => {
    for (const it of items) {
      const d = out.get(it.id);
      if (!d) continue;
      await tx.delete(schema.itemVersions).where(eq(schema.itemVersions.itemId, it.id));
      const [v] = await tx.insert(schema.itemVersions).values({ itemId: it.id, version: 1, content: d.content, note: d.note, author: "ai", sources: d.sources }).returning();
      // Basic fields filled from the account, resume or saved answers need no approval (#108).
      const auto = it.kind === "field" && !!d.content.trim();
      await tx.update(schema.applicationItems).set({ question: d.question, approvedVersionId: auto ? v.id : null }).where(eq(schema.applicationItems.id, it.id));
    }
  });
  return { keywords, postingText: inp.posting.text, traps: inp.traps ?? [] };
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
