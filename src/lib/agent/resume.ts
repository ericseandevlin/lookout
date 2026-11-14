import "server-only";
import { readLink } from "./links";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { readUserFile } from "@/lib/files";
import { decodeEntities } from "@/lib/ai/entities";
import { AiConfigError, completeJSON, emptyUsage } from "@/lib/ai/llm";
import { traceAs } from "@/lib/ai/trace";
import { startBudgetedRun, BudgetError, finishRun, progress, startRun } from "@/lib/ai/runs";
import { getAiConfig } from "@/lib/config";
import { getActiveSearch } from "@/lib/searches";

const MAX_RESUME_CHARS = 60_000;

class NoTextError extends Error {}

export async function extractResumeText(buf: Buffer, mime: string) {
  if (mime === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  const mammoth = await import("mammoth");
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  return docxHtmlToText(value);
}

/**
 * Word text from mammoth's HTML, not its raw text: raw text drops list bullets, so the master rebuild
 * couldn't tell a dropped bullet from a heading (#1263), and it runs line breaks together.
 * Each paragraph is its own line, a list item starts with "• ", paragraphs are a blank line apart.
 */
export function docxHtmlToText(html: string): string {
  const text = html
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h\d|ul|ol|tr|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return (
    decodeEntities(text)
      .split("\n")
      .map((l) => l.replace(/[ \t ]+/g, " ").trim())
      // A nested list opens an empty item for its parent level.
      .filter((l) => l && l !== "•")
      .join("\n\n") + "\n"
  );
}

export const Fills = z.object({
  summary: z.string().describe("Three to five sentences on who this person is professionally, in plain words."),
  next_role: z
    .string()
    .describe("A one-line guess at the next role that would be a step up, based on their trajectory. Empty if unclear."),
  area: z.string().describe("City or region they are based in, e.g. 'New York, NY'. Empty if not stated."),
  modes: z.array(z.enum(["On-site", "Hybrid", "Remote"])).describe("Work modes that fit their history. Empty if unclear."),
  linkedin: z.string().describe("LinkedIn handle after linkedin.com/in/, if present. Empty otherwise."),
  lead_win: z
    .string()
    .describe("Their strongest quantified result, one sentence, in first person. Empty if none is stated."),
  links: z.array(z.string()).describe("Personal websites, portfolios or social profiles listed, as URLs. Exclude LinkedIn."),
});

/**
 * Read an uploaded resume, store its text for the discovery agent, and fill
 * empty profile answers. Answers the user already wrote are never overwritten.
 */
export async function scanResume(userId: string, materialId: string) {
  const [m] = await db.select().from(schema.materials).where(eq(schema.materials.id, materialId));
  if (!m?.fileKey) return;
  traceAs("resume", userId, materialId);
  const usage = emptyUsage();
  let runId: string | null = null;
  let hasText = false;
  try {
    const text = (await extractResumeText(await readUserFile(m.fileKey), m.mime ?? "")).slice(0, MAX_RESUME_CHARS).trim();
    if (!text) throw new NoTextError("no readable text in this file");
    // Keep the text even if the AI step fails: discovery still reads it, and setup can finish.
    await db.update(schema.materials).set({ extracted: { text } }).where(eq(schema.materials.id, materialId));
    hasText = true;
    if ((await getAiConfig()).provider === "agent") {
      // The external agent fills answers when it picks up the job.
      const run = await startRun(userId, "resume", { status: "queued", request: { type: "resume", materialId } });
      await progress(run.id, 0, "Waiting for the search agent to read your resume");
      await db
        .update(schema.materials)
        .set({ status: "done", scannedAt: new Date(), filledNote: "saved, auto-fill is queued" })
        .where(eq(schema.materials.id, materialId));
      return;
    }
    runId = (await startBudgetedRun(userId, "resume")).id;

    const f = await completeJSON({
      name: "resume",
      schema: Fills,
      usage,
      maxTokens: 3000,
      system:
        "You read resumes and pull out facts for a job-search profile. Only use what the resume says or clearly implies. Leave a field empty rather than guess.",
      user: `<resume>\n${text}\n</resume>`,
    });
    await applyResumeResult(userId, materialId, f);
    await finishRun(runId, usage, {});
  } catch (e) {
    console.error("scanResume", e);
    await db
      .update(schema.materials)
      .set(
        !hasText
          ? { status: "failed", filledNote: e instanceof NoTextError ? e.message : "couldn't read this file" }
          : { status: "done", scannedAt: new Date(), filledNote: `saved, but auto-fill didn't run (${skipReason(e)})` },
      )
      .where(eq(schema.materials.id, materialId));
    if (runId) await finishRun(runId, usage, { error: String(e) });
  }
}

/** Why the AI step didn't fill answers, in the words the profile page shows. */
function skipReason(e: unknown) {
  if (e instanceof BudgetError) return "today's AI limit is used up, try again tomorrow";
  if (e instanceof AiConfigError) return "the AI isn't set up";
  return "the AI step failed, try uploading again later";
}

const LABELS: Record<string, string> = { q1: "next role", area: "where you work", modes: "work modes", q4: "lead win" };

/** Fill empty profile answers from a resume read, then record what was filled. Used by both the built-in model and the external agent. */
export async function applyResumeResult(userId: string, materialId: string, f: z.infer<typeof Fills>) {
  const filled = await applyFills(userId, { q1: f.next_role, area: f.area, modes: f.modes, q4: f.lead_win });
  if (f.linkedin) await fillLinkedin(userId, f.linkedin);
  await addMissingLinks(userId, f.links);
  const [m] = await db.select().from(schema.materials).where(eq(schema.materials.id, materialId));
  await db
    .update(schema.materials)
    .set({
      status: "done",
      scannedAt: new Date(),
      extracted: { text: m?.extracted?.text, summary: f.summary },
      filledNote: filled.length ? `filled ${filled.map((k) => LABELS[k] ?? k).join(", ")}` : "nothing new to fill, your answers were already set",
    })
    .where(eq(schema.materials.id, materialId));
  return filled;
}

async function applyFills(userId: string, fills: Record<string, string | string[]>) {
  // Answers live on the active search now (#8).
  const s = await getActiveSearch(userId);
  if (!s) return [];
  const answers = { ...(s?.answers ?? {}) };
  const auto = { ...(s?.autofilled ?? {}) };
  const filled: string[] = [];
  for (const [k, v] of Object.entries(fills)) {
    const has = Array.isArray(answers[k]) ? (answers[k] as string[]).length > 0 : !!answers[k];
    const value = Array.isArray(v) ? v.length > 0 : !!v;
    if (has || !value) continue;
    answers[k] = v;
    auto[k] = "resume";
    filled.push(k);
  }
  await db
    .update(schema.searches)
    .set({ answers, autofilled: auto, updatedAt: new Date() })
    .where(eq(schema.searches.id, s!.id));
  return filled;
}

async function fillLinkedin(userId: string, handle: string) {
  const rows = await db.select().from(schema.materials).where(eq(schema.materials.userId, userId));
  if (rows.some((r) => r.kind === "linkedin")) return;
  const clean = handle.replace(/^(https?:\/\/)?(www\.)?linkedin\.com\/in\//i, "").replace(/\/+$/, "").slice(0, 100);
  if (clean) await db.insert(schema.materials).values({ userId, kind: "linkedin", url: clean });
}

async function addMissingLinks(userId: string, links: string[]) {
  const rows = await db.select().from(schema.materials).where(eq(schema.materials.userId, userId));
  const have = new Set(rows.filter((r) => r.kind === "link").map((r) => norm(r.url ?? "")));
  let pos = have.size;
  for (const url of links.slice(0, 6)) {
    if (!url || /linkedin\.com/i.test(url) || /^(javascript|data|vbscript|file|mailto|tel):/i.test(url) || have.has(norm(url))) continue;
    have.add(norm(url));
    const [row] = await db.insert(schema.materials).values({ userId, kind: "link", url: url.slice(0, 500), position: pos++ }).returning();
    void readLink(row.id, row.url!).catch(() => {});
  }
}

const norm = (u: string) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
