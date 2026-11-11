import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { completeJSON, emptyUsage, type Usage } from "@/lib/ai/llm";
import { assertBudget, finishRun, progress, startRun } from "@/lib/ai/runs";
import { emptyTally } from "./report";
import { applyRules } from "./rules";
import { kindOf } from "@/lib/kinds";
import { samConfigured } from "@/lib/sources";
import { keepRfps, rfpText, SAM_URL, samQueries, SamResponse, setAsideCodes, type RfpItem } from "@/lib/samGov";
import { loadContext, makeReport, profileBlock, type Context } from "./discover";
import { ensureSearchProfile } from "./searchProfile";

/**
 * RFP discovery (#272): SAM.gov first. The API gives structured notices, so there is no web search
 * or page reading: fetch, filter, score in batches, save to the search's board.
 */

const BATCH = 6;
const MAX_SCORED = 30;
const today = () => new Date().toISOString().slice(0, 10);


async function fetchSam(params: URLSearchParams) {
  params.set("api_key", process.env.SAM_API_KEY ?? "");
  const res = await fetch(`${SAM_URL}?${params}`, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
  // Never log the URL: it carries the key.
  if (!res.ok) throw new Error(`SAM.gov answered ${res.status}`);
  return SamResponse.parse(await res.json()).opportunitiesData;
}

const RfpScore = z.object({
  finds: z.array(
    z.object({
      index: z.number().int(),
      score: z.number().int().min(1).max(5).describe("Fit: 5 = a bid they should make, 3 = possible, 1 = not their work"),
      reasons_match: z.array(z.string()).describe("Up to 4 short, specific reasons it fits the business, addressed as 'you'"),
      reasons_gap: z.array(z.string()).describe("Up to 3 short, specific reasons it may not fit"),
      location_fit: z.boolean().describe("True if the place of performance is somewhere they can serve (or none given)"),
      dealbreaker: z.boolean().describe("True only if it clearly hits something they ruled out"),
    }),
  ),
});

// Built per call: a module constant would keep the date the server started.
const rfpSystem = () => `You score government solicitations for one business. Today is ${today()}.
Only use the facts given for each notice; never invent values or dates. Reasons are read on a phone: short and concrete.`;

async function scoreRfps(ctx: Context, items: RfpItem[], usage: Usage) {
  const out: { item: RfpItem; s: z.infer<typeof RfpScore>["finds"][number] }[] = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    try {
      const res = await completeJSON({
        name: "score_rfps",
        schema: RfpScore,
        usage,
        maxTokens: 3000,
        system: rfpSystem(),
        user: `${profileBlock(ctx)}\n\n<notices>\n${batch.map((it, j) => `[${j}]\n${rfpText(it)}`).join("\n\n")}\n</notices>\n\nReturn one entry per notice, using its [n] as index.`,
      });
      for (const s of res.finds) if (batch[s.index]) out.push({ item: batch[s.index], s });
    } catch (e) {
      console.error("[rfp] scoring batch failed", e);
    }
  }
  return out;
}

async function saveRfps(ctx: Context, scored: Awaited<ReturnType<typeof scoreRfps>>) {
  const t = emptyTally();
  for (const { item, s } of scored) {
    t.postings++;
    const ruled = applyRules({ score: s.score, reasonsMatch: s.reasons_match, reasonsGap: s.reasons_gap, locationFit: s.location_fit, dealbreaker: s.dealbreaker, compMin: item.value, compMax: item.value }, ctx.floor);
    if (!ruled) {
      t.dealbreaker++;
      continue;
    }
    // Under the floor: left off (#740).
    if (ctx.floor && item.value && item.value < ctx.floor) {
      t.belowFloor++;
      continue;
    }
    if (!s.location_fit) t.offLocation++;
    const [opp] = await db
      .insert(schema.opportunities)
      .values({
        type: "rfp",
        company: (item.agency || "Federal agency").slice(0, 200),
        title: item.title.slice(0, 300),
        location: item.place.slice(0, 200),
        postedAt: item.posted,
        sourceUrl: item.url,
        description: rfpText(item).slice(0, 2000),
        attributes: { due: item.due ?? "", setAside: item.setAside, ...(item.value && { value: item.value }), naics: item.naics, noticeId: item.noticeId, source: "sam.gov" },
        fingerprint: `sam:${item.noticeId}`,
      })
      .onConflictDoUpdate({ target: schema.opportunities.fingerprint, set: { sourceUrl: item.url } })
      .returning();
    const inserted = await db
      .insert(schema.userOpportunities)
      .values({ userId: ctx.userId, searchId: ctx.searchId, opportunityId: opp.id, score: ruled.score, reasonsMatch: ruled.reasonsMatch, reasonsGap: ruled.reasonsGap, addedVia: "agent", stage: kindOf("rfp").defaultStage })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) t.added++;
    else t.known++;
  }
  return t;
}

/** Notice IDs already on this search's board, so the same notice isn't scored twice. */
async function knownNotices(searchId: string) {
  const rows = await db
    .select({ fp: schema.opportunities.fingerprint })
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(eq(schema.userOpportunities.searchId, searchId));
  return new Set(rows.map((r) => r.fp.replace(/^sam:/, "")));
}

/** One rfp search: SAM.gov, filtered to what the business can bid on, scored and saved. */
export async function discoverRfp(searchId: string, userId: string, trigger: "scheduled" | "manual") {
  if (!samConfigured()) throw new Error("RFP search needs a SAM.gov API key (SAM_API_KEY).");
  await assertBudget(userId);
  const run = await startRun(userId, trigger, { searchId });
  const usage = emptyUsage();
  try {
    await progress(run.id, 5, "Reading your profile");
    const ctx = await loadContext(searchId);
    ctx.searchProfile = (await ensureSearchProfile(searchId, usage)).profile;
    const queries = samQueries(ctx.answers);
    await progress(run.id, 15, "Searching SAM.gov for open solicitations");
    const raw = (await Promise.all(queries.map((q) => fetchSam(q).catch((e) => (console.error("[rfp] SAM.gov", e instanceof Error ? e.message : e), []))))).flat();
    const items = keepRfps(raw, { today: today(), known: await knownNotices(searchId), setAsides: setAsideCodes(ctx.answers.certs) }).slice(0, MAX_SCORED);
    await progress(run.id, 40, `Found ${items.length} open ${items.length === 1 ? "notice" : "notices"} you can bid on. Scoring them`);
    const scored = await scoreRfps(ctx, items, usage);
    await progress(run.id, 95, "Saving new finds");
    const tally = await saveRfps(ctx, scored);
    await progress(run.id, 100, tally.added ? `Added ${tally.added} new ${tally.added === 1 ? "solicitation" : "solicitations"}` : "No new solicitations this time");
    const report = makeReport(ctx, { queries: queries.map((q) => `SAM.gov ${q.get("ncode") ? `NAICS ${q.get("ncode")}` : "all NAICS"}`), results: raw.length, picked: items.length, read: items.length, tally });
    await finishRun(run.id, usage, { found: tally.postings, added: tally.added, report });
    return { found: tally.postings, added: tally.added, runId: run.id };
  } catch (e) {
    await finishRun(run.id, usage, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
