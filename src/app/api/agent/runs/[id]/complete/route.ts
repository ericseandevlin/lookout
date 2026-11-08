import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { body, HttpError, json } from "@/lib/api";
import { agentRoute } from "@/lib/agentAuth";
import { db, schema } from "@/lib/db";
import { loadContext, makeReport, save, ScoredList } from "@/lib/agent/discover";
import { autoQueue } from "@/lib/apply";
import { applyResumeResult, Fills } from "@/lib/agent/resume";
import { emptyUsage } from "@/lib/ai/llm";
import { finishRun, progress } from "@/lib/ai/runs";
import { sendDigest } from "@/lib/digest";
import { getActiveSearch } from "@/lib/searches";

const Finding = ScoredList.shape.finds.element.omit({ index: true }).extend({ url: z.string().url().max(1000) });
const Input = z.object({
  finds: z.array(Finding).max(40).optional(),
  fills: Fills.optional(),
  error: z.string().max(500).optional(),
  searches: z.number().int().min(0).max(500).optional(),
  /** For the after-search report: the queries run, results seen, and pages opened. */
  queries: z.array(z.string().max(300)).max(20).optional(),
  results: z.number().int().min(0).max(1000).optional(),
  read: z.number().int().min(0).max(200).optional(),
});
type Ctx = { params: Promise<{ id: string }> };

/** The agent hands back results. Hard rules, dedupe and saving all happen here, not in the agent. */
export const POST = agentRoute<Ctx>(async (req, { params }) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  const p = await body(req, Input);
  const [run] = await db.select().from(schema.runs).where(and(eq(schema.runs.id, id), eq(schema.runs.status, "running")));
  if (!run) throw new HttpError(409, "That job isn't running");
  const usage = { ...emptyUsage(), searches: p.searches ?? 0 };
  const type = (run.request as { type?: string } | null)?.type ?? "discover";

  if (p.error) {
    await finishRun(id, usage, { error: p.error });
    return json({ ok: true });
  }
  if (type === "resume") {
    const materialId = (run.request as { materialId?: string }).materialId;
    if (!p.fills || !materialId) throw new HttpError(400, "Resume jobs need fills");
    const filled = await applyResumeResult(run.userId, materialId, p.fills);
    await progress(id, 100, filled.length ? `Filled ${filled.length} answers from your resume` : "Read your resume. Your answers were already set");
    await finishRun(id, usage, {});
    return json({ ok: true, filled });
  }

  // Finds go to the run's search; account-level runs fall back to the active one, as the queue does (#398).
  const searchId = run.searchId ?? (await getActiveSearch(run.userId))?.id;
  if (!searchId) {
    await finishRun(id, usage, { error: "No search to save finds to" });
    throw new HttpError(409, "No search to save finds to");
  }
  const ctx = await loadContext(searchId);
  const finds = (p.finds ?? []).map((f, index) => ({ ...f, index }));
  const { newFinds, ...tally } = await save(ctx, finds, type === "url" ? "manual" : "agent");
  if (type !== "url") await autoQueue(run.userId, newFinds).catch((e) => console.error("[auto-apply] queue failed", e));
  const { added, postings: found } = tally;
  await progress(id, 100, added ? `Added ${added} new ${added === 1 ? "find" : "finds"}` : found ? "No new finds this time. Everything matching is already on your board" : "No matching open roles this time");
  const report =
    type === "url" ? undefined : makeReport(ctx, { queries: p.queries ?? [], results: p.results ?? finds.length, picked: p.read ?? finds.length, read: p.read ?? finds.length, tally });
  await finishRun(id, usage, { found, added, report });
  // Even with nothing new: pinned finds due soon still go out, once a day (#304).
  if (run.trigger === "scheduled") await sendDigest(run.userId, id).catch(() => {});
  return json({ ok: true, found, added });
});
