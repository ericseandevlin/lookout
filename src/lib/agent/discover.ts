import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { kinds, parseMoney } from "@/lib/kinds";
import { addUsage, assertBudget, claude, emptyUsage, finishRun, startRun, textOf, type Usage } from "./claude";
import { applyRules, fingerprint, normUrl } from "./rules";

const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
const MAX_CONTINUATIONS = 6;

type Context = {
  userId: string;
  brief: string;
  resume: string;
  links: string[];
  floor: number | null;
  knownUrls: string[];
};

async function loadContext(userId: string): Promise<Context> {
  const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const mats = await db.select().from(schema.materials).where(eq(schema.materials.userId, userId));
  const resume = mats.find((m) => m.kind === "resume");
  const li = mats.find((m) => m.kind === "linkedin");
  const known = await db
    .select({ url: schema.opportunities.sourceUrl })
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(eq(schema.userOpportunities.userId, userId));
  const answers = p?.answers ?? {};
  return {
    userId,
    brief: kinds[p?.kind ?? "job"].brief(answers),
    resume: resume?.extracted?.summary
      ? `${resume.extracted.summary}\n\n${(resume.extracted.text ?? "").slice(0, 12_000)}`
      : "",
    links: [
      ...(li?.url ? [`https://www.linkedin.com/in/${li.url}`] : []),
      ...mats.filter((m) => m.kind === "link" && m.url).map((m) => m.url!),
    ],
    floor: parseMoney(answers.floor),
    knownUrls: known.map((k) => k.url).filter((u): u is string => !!u),
  };
}

const profileBlock = (c: Context) =>
  `<profile>\n${c.brief}\n</profile>\n<resume>\n${c.resume || "(no resume uploaded)"}\n</resume>\n<links>\n${c.links.join("\n") || "(none)"}\n</links>`;

/** Run a server-tool request to completion, resuming on pause_turn. */
async function runWithTools(params: Anthropic.Beta.MessageCreateParamsNonStreaming, usage: Usage) {
  const messages = [...params.messages];
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const res = await claude().beta.messages.stream({ ...params, messages }).finalMessage();
    addUsage(usage, params.model, res.usage);
    if (res.stop_reason === "refusal") throw new Error("The model declined this search");
    if (res.stop_reason !== "pause_turn") return res;
    messages.push({ role: "assistant", content: res.content });
  }
  throw new Error("Search did not finish");
}

const Candidate = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string().describe("City and state, plus (on-site), (hybrid) or (remote) when known"),
  work_mode: z.enum(["On-site", "Hybrid", "Remote", "Unknown"]),
  comp_min: z.number().nullable().describe("Annual base salary low end in USD, null if not posted"),
  comp_max: z.number().nullable().describe("Annual base salary high end in USD, null if not posted"),
  posted_at: z.string().nullable().describe("ISO date YYYY-MM-DD the posting went up, null if unknown"),
  url: z.string().describe("Direct URL to the posting"),
  description: z.string().describe("Two or three plain sentences on the role"),
  score: z.number().int().min(1).max(5).describe("Fit against the profile: 5 = bullseye, 1 = poor"),
  reasons_match: z.array(z.string()).describe("Up to 4 short, specific reasons it fits. One line each, addressed to the candidate as 'you'."),
  reasons_gap: z.array(z.string()).describe("Up to 3 short, specific reasons it may not fit. Empty if none."),
  location_fit: z.boolean().describe("True if the location and work mode fit the stated preferences (or none were stated)"),
  dealbreaker: z.boolean().describe("True only if it clearly hits something the candidate ruled out"),
});
const Candidates = z.object({ finds: z.array(Candidate) });
type CandidateT = z.infer<typeof Candidate>;

const SCORER_SYSTEM = `You score job postings for one candidate. Read the profile, resume and postings, then return structured data.
Scoring: 5 = the role they described at the level they want; 4 = strong fit with one real gap; 3 = plausible but a step sideways or with several gaps; 2 = weak; 1 = poor.
Reasons are for the candidate to read on a phone: short, concrete, no filler. Do not invent comp or dates that the posting does not state.`;

async function score(ctx: Context, research: string, usage: Usage): Promise<CandidateT[]> {
  const res = await claude().beta.messages.parse({
    model: env.model,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(Candidates) },
    system: SCORER_SYSTEM,
    messages: [{ role: "user", content: `${profileBlock(ctx)}\n\n<postings>\n${research}\n</postings>` }],
  });
  addUsage(usage, env.model, res.usage);
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("Scoring failed");
  return res.parsed_output.finds;
}

/** Insert scored finds the user doesn't already have. Returns how many were added. */
async function save(ctx: Context, finds: CandidateT[], via: "agent" | "manual") {
  const known = new Set(ctx.knownUrls.map(normUrl));
  let added = 0;
  for (const f of finds) {
    if (!f.company || !f.title || !/^https?:\/\//i.test(f.url)) continue;
    if (via === "agent" && known.has(normUrl(f.url))) continue;
    const ruled = applyRules(
      {
        score: f.score,
        reasonsMatch: f.reasons_match,
        reasonsGap: f.reasons_gap,
        locationFit: f.location_fit,
        dealbreaker: f.dealbreaker,
        compMin: f.comp_min,
        compMax: f.comp_max,
      },
      ctx.floor,
    );
    if (!ruled) continue;
    const fp = fingerprint(f.company, f.title, f.location);
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
        fingerprint: fp,
      })
      .onConflictDoUpdate({
        target: schema.opportunities.fingerprint,
        // Refresh fields a newer read may have improved.
        set: { sourceUrl: f.url.slice(0, 1000), description: f.description.slice(0, 2000) },
      })
      .returning();
    const inserted = await db
      .insert(schema.userOpportunities)
      .values({
        userId: ctx.userId,
        opportunityId: opp.id,
        score: ruled.score,
        reasonsMatch: ruled.reasonsMatch,
        reasonsGap: ruled.reasonsGap,
        addedVia: via,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) added++;
    known.add(normUrl(f.url));
  }
  return added;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Weekly (or scheduled) search: find new postings, score them, add them to the board. */
export async function discover(userId: string, trigger: "scheduled" | "manual" = "scheduled") {
  await assertBudget(userId);
  const run = await startRun(userId, trigger);
  const usage = emptyUsage();
  try {
    const ctx = await loadContext(userId);
    const skip = ctx.knownUrls.slice(-150);
    const research = await runWithTools(
      {
        model: env.model,
        max_tokens: 32000,
        ...FALLBACK,
        output_config: { effort: "medium" },
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 15 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 20, max_content_tokens: 12000 },
        ],
        system: `You are a recruiter's research assistant. Today is ${today()}. You find currently open job postings for one candidate.`,
        messages: [
          {
            role: "user",
            content: `${profileBlock(ctx)}

Find 8 to 15 open roles that fit this candidate. Rules:
- Prefer the employer's own posting (company careers page or an ATS such as Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters). Use job boards to discover roles, then follow through to the real posting when you can.
- Only include postings that look open now and were posted in roughly the last 45 days. Fetch a posting when you need to confirm it is live or to read the pay range.
- Respect the comp floor, locations, work modes and dealbreakers, but include a strong role slightly outside them and say why.
- Skip these URLs, already on the board:
${skip.join("\n") || "(none)"}

For each role, report company, title, location, work mode, posted pay range (base, exactly as stated), posting date, the direct URL and two sentences on the role. Plain text is fine.`,
          },
        ],
      },
      usage,
    );
    const text = textOf(research.content);
    const finds = text.trim() ? await score(ctx, text, usage) : [];
    const added = await save(ctx, finds, "agent");
    await finishRun(run.id, usage, { found: finds.length, added });
    return { found: finds.length, added };
  } catch (e) {
    await finishRun(run.id, usage, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Manual add: fetch one posting by URL, score it, add it. */
export async function addByUrl(userId: string, url: string) {
  await assertBudget(userId);
  const run = await startRun(userId, "url");
  const usage = emptyUsage();
  try {
    const ctx = await loadContext(userId);
    const read = await runWithTools(
      {
        model: env.model,
        max_tokens: 8000,
        ...FALLBACK,
        output_config: { effort: "low" },
        tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, max_content_tokens: 15000 }],
        messages: [
          {
            role: "user",
            content: `Fetch this job posting and report company, title, location, work mode, posted pay range (base, exactly as stated), posting date and a short summary. If the page is not a job posting or will not load, say so.\n\n${url}`,
          },
        ],
      },
      usage,
    );
    const finds = await score(ctx, `URL: ${url}\n${textOf(read.content)}`, usage);
    const one = finds.slice(0, 1).map((f) => ({ ...f, url, dealbreaker: false }));
    const added = await save(ctx, one, "manual");
    await finishRun(run.id, usage, { found: one.length, added });
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
    .where(and(eq(schema.runs.userId, userId), eq(schema.runs.status, "running")))
    .limit(1);
  return r.length > 0;
}
