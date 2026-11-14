import "server-only";
import { and, eq, inArray, lt, max, sql } from "drizzle-orm";
import { fetch } from "undici";
import { db, schema } from "@/lib/db";
import type { ApplicationReport, ApplicationStatus } from "@/lib/db/schema";
import { completeJSON, emptyUsage, type Usage } from "@/lib/ai/llm";
import { traceAs } from "@/lib/ai/trace";
import { assertBudget } from "@/lib/ai/runs";
import { fetchPage, pageToText } from "@/lib/ai/fetchPage";
import { kinds } from "@/lib/kinds";
import { humanize, shapeResume } from "./resumeLayout";
import { match, savedBlock } from "./saved";
import { notesBlock } from "./skills";
import { checkStory } from "./stories";
import { STRATEGY, suggestStrategy, type LetterStrategy } from "./letterStrategy";
import { HttpError } from "@/lib/api";
import { KEYWORD_PLAN_SYSTEM, KeywordPlanDraft, approvedBlock, approvedFor, finalTerms, keywordPlanPrompt, planFrom, unapprovedIn, type KeywordRow } from "./evidence";
import { keywordState, lockEditable } from "./review";
import { findTraps, removeTraps, stripBoilerplate, stripHidden, trapWordsIn } from "./posting";
import { ensureMaster } from "./master";
import { findOutreach, type OutreachItem } from "./outreach";
import { roleSwaps } from "./masterCheck";
import { askPer, asksBase, asksMinimum, isSalaryQuestion, rangeBasis, suggestSalary } from "./salary";
import { getActiveSearch } from "@/lib/searches";
import {
  ANSWERS_SYSTEM,
  AnswersDraft,
  RESUME_SYSTEM,
  ResumeDraft,
  answersPrompt,
  checkAnswer,
  fillField, PREFERRED_NAME,
  linkedinUrl,
  withLinkedin,
  keywordReport,
  newNumbers,
  resumeNote,
  resumePrompt,
  type DraftInputs,
  type DraftItem,
  type Drafted,
} from "./draft";
import { ASHBY_QUERY, PAGE_SYSTEM, PageItems, applyUrlFor, ashbyOrgFromHtml, boardFromHtml, boardGuesses, detectAts, fromPage, parseAshby, parseGreenhouse, routeFor, withBasics, type ScanResult } from "./scan";
import { addUsd, patchReport } from "./reportStore";
import { autoApproveField } from "./flowRules";
import { compLabel } from "@/lib/digestComp";

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
  const host = new URL(postingUrl).hostname;
  // A greenhouse.io host says nothing about the company, so there is nothing to guess (#674).
  const guesses = /(^|\.)greenhouse\.io$/i.test(host) ? [] : boardGuesses(host);
  for (const b of found ? [found] : guesses) {
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

/** A company page with ?ashby_jid=: find its org on the page, else try the obvious names (#676). */
async function ashbyEmbedOrForm(org: string, id: string, postingUrl: string) {
  if (org) return { org, form: parseAshby(await ashbyForm(org, id)) };
  const found = ashbyOrgFromHtml((await fetchPage(postingUrl)).html);
  if (found) return { org: found, form: parseAshby(await ashbyForm(found, id)) };
  for (const o of boardGuesses(new URL(postingUrl).hostname)) {
    try {
      return { org: o, form: parseAshby(await ashbyForm(o, id)) };
    } catch {
      // try the next guess
    }
  }
  throw new Error("Couldn't find this company's Ashby board");
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
    if (ref.ats === "ashby") {
      const { org, form } = await ashbyEmbedOrForm(ref.org, ref.id, postingUrl);
      // The embed is an iframe on the company page; Ashby's hosted form is the same application.
      return { ats: ref.ats, route, applyUrl: applyUrlFor({ ...ref, org }, postingUrl), source: "form", ...form };
    }
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
  traceAs("apply", app.userId, app.id);
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
async function loadInputs(userId: string, opp: typeof schema.opportunities.$inferSelect, usage: Usage, postingHtml?: string): Promise<DraftInputs> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  // The brief and pay come from the active search's answers (#8); the rest of the profile is per-account.
  const search = await getActiveSearch(userId);
  const mats = await db.select().from(schema.materials).where(eq(schema.materials.userId, userId));
  // The structured master resume (#131), built once from the upload; the raw PDF text is only a fallback.
  const master = await ensureMaster(userId, usage);
  const li = mats.find((m) => m.kind === "linkedin");
  const resume = withLinkedin(master?.md ?? mats.find((m) => m.kind === "resume")?.extracted?.text?.trim() ?? "", li?.url ? linkedinUrl(li.url) : null);
  if (!resume) throw new Error("Add your resume on your profile first. Lookout drafts from it.");
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
  // "$" only for US dollars: "60,000 – 70,000 GBP", not "$60,000 – $70,000 GBP" (#1095).
  const pay = compLabel(opp.compMin, opp.compMax, opp.currency) ?? "";
  const facts = [`Role: ${opp.title}`, `Company: ${opp.company}`, opp.location && `Location: ${opp.location}`, opp.workMode && `Work mode: ${opp.workMode}`, pay && `Pay range on file: ${pay}`].filter(Boolean).join("\n");
  text = `${facts}\n\n${text}`;
  return {
    name: user?.name ?? "",
    email: user?.email ?? "",
    linkedinUrl: li?.url ? linkedinUrl(li.url) : null,
    links: mats.filter((m) => m.kind === "link" && m.url).map((m) => ({ url: m.url!, text: m.extracted?.text ?? "" })),
    brief: (kinds[search?.kind ?? "job"]?.brief(search?.answers ?? {}) ?? "") + savedBlock(profile?.applyAnswers ?? []) + notesBlock(profile?.skillNotes ?? []),
    notes: notesBlock(profile?.skillNotes ?? []),
    saved: profile?.applyAnswers ?? [],
    stories: profile?.personalStories ?? [],
    pay: { floor: search?.answers?.floor, target: search?.answers?.target },
    resume: resume.slice(0, 20000),
    posting: { company: opp.company, title: opp.title, text },
    traps: cleaned.traps,
  };
}

/** Keywords for the person to check before any draft uses them (#121): posting terms, each with the line of theirs the model says backs it. */
async function proposeKeywords(inp: DraftInputs, usage: Usage) {
  const d = await completeJSON({ name: "apply-keywords", schema: KeywordPlanDraft, system: KEYWORD_PLAN_SYSTEM, user: keywordPlanPrompt(inp.posting.text, inp.resume, inp.notes ?? ""), maxTokens: 3000, usage });
  return planFrom(d, inp.posting.text);
}

/** Until the person approves the keywords, the resume is their master as it stands: nothing is worked in silently (#121). */
const untailored = (inp: DraftInputs): Drafted => ({
  content: shapeResume(humanize(inp.resume.trim())).md,
  note: "- Not tailored to this posting yet. Check the keywords above, then press \"Use these keywords\" to write the tailored resume.",
  sources: ["master resume"],
  question: null,
});

/** The ATS resume and its keyword report, from the person's master resume, the cleaned posting and their approved keywords. */
async function draftResume(inp: DraftInputs, usage: Usage, rows: KeywordRow[]) {
  const d = await completeJSON({ name: "apply-resume", schema: ResumeDraft, system: RESUME_SYSTEM, user: resumePrompt(inp) + approvedBlock(rows), maxTokens: 8000, usage });
  // The report covers exactly the approved list; the model's own keyword picks don't count here.
  const keywords = keywordReport(inp.resume, d.resume, { ...d, keywords: [] }, undefined, { include: finalTerms(rows), exclude: [] });
  const stray = unapprovedIn(d.resume, inp.resume, rows);
  const facts = `${inp.resume}\n${inp.notes ?? ""}`;
  // The 10-second rules, held in code: one-sentence summary, Experience right after it (#129).
  const shaped = shapeResume(humanize(withLinkedin(d.resume.trim(), inp.linkedinUrl)));
  // A bullet that left its job in the confirmed master is the Oct 18 bug coming back: say so (#131).
  const swaps = roleSwaps(inp.resume, shaped.md);
  const draft: Drafted = { content: shaped.md, note: resumeNote(keywords, { ...d, notes: [...d.notes, ...shaped.fixed, ...swaps] }, newNumbers(facts, d.resume)), sources: ["master resume", ...(inp.notes ? ["your experience notes"] : []), "posting"], question: null };
  if (stray.length) {
    draft.note += `\n- Check these, you didn't approve them and your experience doesn't show them: ${stray.join(", ")}`;
    draft.question = `This draft uses ${stray.map((t) => `"${t}"`).join(", ")}, which you didn't approve. Remove ${stray.length === 1 ? "it" : "them"} or add the experience behind ${stray.length === 1 ? "it" : "them"} first.`;
  }
  const hits = trapWordsIn(draft.content, inp.traps ?? [], `${inp.resume}\n${inp.brief}`);
  if (hits.length) draft.question = `This draft includes ${hits.map((h) => `"${h}"`).join(", ")}, which the posting planted to catch automated applications. Remove it unless you mean to include it.`;
  return { draft, keywords };
}

/**
 * Write a fresh resume from the posting, as a new version: for drafts made before a fix, or when the
 * user wants to start that one over. Every other item and approval stays as it is.
 */
/**
 * The item a redraft writes to: the one the person pressed Redraft on, else the first of its kind in form order.
 * A form can carry two cover letters ("Cover letter" upload and "Cover letter text"); by kind alone the other one got
 * the new version and lost its approval (#870).
 */
async function itemToRedraft(appId: string, kind: "cover_letter" | "resume", itemId?: string) {
  const [item] = await db
    .select()
    .from(schema.applicationItems)
    .where(and(eq(schema.applicationItems.applicationId, appId), eq(schema.applicationItems.kind, kind), ...(itemId ? [eq(schema.applicationItems.id, itemId)] : [])))
    .orderBy(schema.applicationItems.position)
    .limit(1);
  return item;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A new version of a ready application sends it back to review; any other status stays. */
const reviewAgain = (s: ApplicationStatus): ApplicationStatus => (s === "approved" || s === "manual" ? "needs_review" : s);

/**
 * Save a redraft against the application's status at write time, not the one read before the model call (#871).
 * If Submit for me claimed it meanwhile, nothing changes but the spend, and the redraft is refused.
 */
async function writeRedraft(appId: string, usd: number, write: (tx: Tx, status: ApplicationStatus) => Promise<void>) {
  try {
    await db.transaction(async (tx) => write(tx, await lockEditable(tx, appId)));
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) await patchReport(appId, addUsd(usd));
    throw e;
  }
}

/** Write a fresh cover letter from the posting as a new version, with the current letter rules (#129). */
export async function redraftLetter(appId: string, strategy?: LetterStrategy, itemId?: string) {
  const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, appId));
  const item = await itemToRedraft(appId, "cover_letter", itemId);
  if (!a || !item) throw new Error("No cover letter on this application");
  await assertBudget(a.userId);
  const [opp] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, a.opportunityId));
  traceAs("redraft", a.userId, a.id);
  const usage = emptyUsage();
  let postingHtml: string | undefined;
  try {
    postingHtml = (await scanPosting(opp.sourceUrl!, usage)).postingHtml;
  } catch {
    // The posting page still works without the ATS's full description.
  }
  const inp = await loadInputs(a.userId, opp, usage, postingHtml);
  // The person's pick (#738), else the strategy the letter already uses, else Lookout's suggestion.
  const using = strategy ?? a.report.letterStrategy ?? suggestStrategy(inp.posting, inp.stories ?? []).strategy;
  inp.letterStrategy = using;
  const one: DraftItem = { index: 0, kind: "cover_letter", prompt: item.prompt, required: item.required, options: null };
  const r = await completeJSON({ name: "apply-letter", schema: AnswersDraft, system: ANSWERS_SYSTEM, user: answersPrompt(inp, [one]), maxTokens: 4000, usage });
  const raw = r.items.find((x) => x.index === 0) ?? r.items[0];
  const d = checkStory(checkAnswer(one, raw), raw, inp.stories ?? [], opp.company);
  const content = humanize(d.content);
  const hits = trapWordsIn(content, inp.traps ?? [], `${inp.resume}\n${inp.brief}`);
  const words = content.split(/\s+/).filter(Boolean).length;
  await writeRedraft(appId, usage.usd, async (tx, now) => {
    const [{ n }] = await tx.select({ n: max(schema.itemVersions.version) }).from(schema.itemVersions).where(eq(schema.itemVersions.itemId, item.id));
    await tx.insert(schema.itemVersions).values({
      itemId: item.id,
      version: (n ?? 0) + 1,
      content,
      note: ["- Redrafted from the posting", `- Strategy: ${STRATEGY[using].label}`, `- ${words} words`, d.note && `- ${d.note}`, hits.length && `- Contains ${hits.map((h) => `"${h}"`).join(", ")} from an instruction planted in the posting`].filter(Boolean).join("\n"),
      author: "ai",
      sources: d.sources.length ? d.sources : ["master resume", "posting"],
    });
    await tx.update(schema.applicationItems).set({ approvedVersionId: null, question: hits.length ? "This letter includes a word the posting planted to catch automated applications. Remove it unless you mean to include it." : d.question }).where(eq(schema.applicationItems.id, item.id));
    await patchReport(appId, (r) => ({ ...addUsd(usage.usd)(r), letterStrategy: using }), { status: reviewAgain(now), updatedAt: new Date() }, tx);
  });
}

export async function redraftResume(appId: string, itemId?: string) {
  const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, appId));
  const item = await itemToRedraft(appId, "resume", itemId);
  if (!a || !item) throw new Error("No resume on this application");
  await assertBudget(a.userId);
  const [opp] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, a.opportunityId));
  traceAs("redraft", a.userId, a.id);
  const usage = emptyUsage();
  let postingHtml: string | undefined;
  try {
    postingHtml = (await scanPosting(opp.sourceUrl!, usage)).postingHtml;
  } catch {
    // The posting page still works without the ATS's full description.
  }
  const inp = await loadInputs(a.userId, opp, usage, postingHtml);
  // Only the list the person said go to, worked out again from today's resume and notes (#121).
  const { rows } = await keywordState(a.userId, a, inp.posting.text);
  if (!approvedFor(a.report, rows)) throw new HttpError(409, "Check the keywords first, then press \"Use these keywords\".");
  const { draft, keywords } = await draftResume(inp, usage, rows);
  await writeRedraft(appId, usage.usd, async (tx, now) => {
    const [{ n }] = await tx.select({ n: max(schema.itemVersions.version) }).from(schema.itemVersions).where(eq(schema.itemVersions.itemId, item.id));
    await tx.insert(schema.itemVersions).values({ itemId: item.id, version: (n ?? 0) + 1, content: draft.content, note: `- Redrafted from the posting\n${draft.note}`, author: "ai", sources: draft.sources });
    await tx.update(schema.applicationItems).set({ approvedVersionId: null, question: draft.question }).where(eq(schema.applicationItems.id, item.id));
    await patchReport(appId, (r) => ({ ...addUsd(usage.usd)(r), keywords, postingText: inp.posting.text, traps: inp.traps ?? [] }), { status: reviewAgain(now), updatedAt: new Date() }, tx);
  });
}

/** Draft version 1 of every item. Returns the resume's keyword report and the posting text it drafted from. */
async function draftAll(id: string, userId: string, opp: typeof schema.opportunities.$inferSelect, usage: Usage, postingHtml?: string) {
  const inp = await loadInputs(userId, opp, usage, postingHtml);
  inp.letterStrategy = suggestStrategy(inp.posting, inp.stories ?? []).strategy;
  const items = await db.select().from(schema.applicationItems).where(eq(schema.applicationItems.applicationId, id)).orderBy(schema.applicationItems.position);
  const out = new Map<string, Drafted>();
  let keywordPlan: ReturnType<typeof planFrom> | undefined;

  const resumeItem = items.find((i) => i.kind === "resume");
  if (resumeItem) {
    keywordPlan = await proposeKeywords(inp, usage);
    out.set(resumeItem.id, untailored(inp));
  }

  const rest: (DraftItem & { id: string })[] = [];
  for (const [index, it] of items.entries()) {
    // EEO answers come only from the person's consented profile, filled in code; never drafted (#122).
    if (it.kind === "resume" || it.kind === "eeo") continue;
    // A form question aimed at automated tools goes to the person, never the model (#116).
    if (findTraps(it.prompt).length) {
      out.set(it.id, { content: "", note: "This question looks planted to catch automated applications, so Lookout left it to you.", sources: [], question: `Answer this one yourself: "${it.prompt.slice(0, 200)}"` });
      continue;
    }
    const savedHit = match(inp.saved ?? [], it.prompt, it.options);
    const saved = savedHit ? { content: savedHit, note: "From your saved answers. Edit them on your profile.", sources: ["saved answer"], question: null } : null;
    // A preferred name they typed once ("Bob") beats the account's first name ("Robert") (#1048).
    const fact = saved && PREFERRED_NAME.test(it.prompt) ? saved : ((it.kind === "field" ? fillField(it.prompt, inp) : null) ?? saved);
    if (fact) out.set(it.id, fact);
    else rest.push({ id: it.id, index, kind: it.kind, prompt: it.prompt, required: it.required, options: it.options, multi: it.fieldType === "multiselect" });
  }
  if (rest.length) {
    const r = await completeJSON({ name: "apply-answers", schema: AnswersDraft, system: ANSWERS_SYSTEM, user: answersPrompt(inp, rest), maxTokens: 8000, usage });
    const byIndex = new Map(r.items.map((a) => [a.index, a]));
    for (const it of rest) {
      const raw = byIndex.get(it.index);
      const checked = checkAnswer(it, raw);
      // The personal line must come from a saved story, or Lookout asks for one (#155).
      const a = it.kind === "cover_letter" ? checkStory(checked, raw, inp.stories ?? [], opp.company) : checked;
      // Salary asks are math, not model judgment: the top quarter of their range, never below the floor (#139).
      const ask = !it.options?.length && isSalaryQuestion(it.prompt) ? suggestSalary({ ...inp.pay, min: opp.compMin, max: opp.compMax, basis: rangeBasis(inp.posting.text), asksBase: asksBase(it.prompt), asksMinimum: asksMinimum(it.prompt), per: askPer(it.prompt) }) : null;
      if (ask) out.set(it.id, { content: ask.amount ?? "", note: ask.note, sources: ["posting range", "your profile: comp floor and target"], question: ask.question ?? null });
      // Choice answers must stay exactly as the form words them.
      else out.set(it.id, it.options?.length ? a : { ...a, content: humanize(a.content) });
    }
  }

  // Public people research is useful but optional: an outage must not cost the whole application.
  let outreach: OutreachItem[] = [];
  try {
    outreach = await findOutreach(inp, usage);
  } catch (e) {
    console.error("[apply] people to reach unavailable", e);
  }

  // Last check: a trap word in any draft (and not in the person's own materials) sends it back to them.
  for (const [itemId, d] of out) {
    const hits = trapWordsIn(d.content, inp.traps ?? [], `${inp.resume}\n${inp.brief}`);
    if (hits.length) {
      d.note = [d.note.trim(), `- Contains ${hits.map((h) => `"${h}"`).join(", ")} from an instruction planted in the posting`].filter(Boolean).join("\n");
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
      const auto = autoApproveField(it.kind, d.content);
      await tx.update(schema.applicationItems).set({ question: d.question, approvedVersionId: auto ? v.id : null }).where(eq(schema.applicationItems.id, it.id));
    }
    for (const [index, person] of outreach.entries()) {
      const [item] = await tx
        .insert(schema.applicationItems)
        .values({ applicationId: id, kind: "outreach", prompt: person.prompt, required: false, position: items.length + index })
        .returning();
      await tx.insert(schema.itemVersions).values({ itemId: item.id, version: 1, content: person.draft.content, note: person.draft.note, author: "ai", sources: person.draft.sources });
    }
  });
  return { keywordPlan, keywords: undefined, keywordsApproved: undefined, postingText: inp.posting.text, traps: inp.traps ?? [], letterStrategy: items.some((i) => i.kind === "cover_letter") ? inp.letterStrategy : undefined };
}

/** What a submit the server lost track of records (#864). It may have gone through, so it counts as clicked (#865). */
export const LOST_SUBMIT = "Lookout lost track of this submit, most likely because the server restarted. Check the job site and your email to see whether it went through before you send it again.";

/**
 * Re-queue work a restart interrupted, then return what's waiting. One user, or everyone.
 * A submit runs in the background of one process (startFill); if that process dies the application sat in
 * "submitting" for good, locked against edits, cancel and marking it sent (#864). After 10 minutes it moves to the
 * manual checklist with a note to check whether it went out.
 */
async function leftovers(userId?: string) {
  const stale = new Date(Date.now() - 30 * 60_000);
  const mine = userId ? [eq(schema.applications.userId, userId)] : [];
  await db
    .update(schema.applications)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(inArray(schema.applications.status, ["scanning", "drafting"]), lt(schema.applications.updatedAt, stale), ...mine));
  const fill: NonNullable<ApplicationReport["fill"]> = { mode: "submit", at: new Date().toISOString(), log: [], missing: [], stopped: LOST_SUBMIT, clicked: true };
  await db
    .update(schema.applications)
    .set({ status: "manual", updatedAt: new Date(), report: sql`${schema.applications.report} || ${JSON.stringify({ fill })}::jsonb` })
    .where(and(eq(schema.applications.status, "submitting"), lt(schema.applications.updatedAt, new Date(Date.now() - 10 * 60_000)), ...mine));
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
