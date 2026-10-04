import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { readUserFile } from "@/lib/files";
import { completeJSON, emptyUsage } from "@/lib/ai/llm";
import { assertBudget, finishRun, startRun } from "@/lib/ai/runs";

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
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value;
}

const Fills = z.object({
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
  const usage = emptyUsage();
  let runId: string | null = null;
  let hasText = false;
  try {
    const text = (await extractResumeText(await readUserFile(m.fileKey), m.mime ?? "")).slice(0, MAX_RESUME_CHARS).trim();
    if (!text) throw new NoTextError("no readable text in this file");
    // Keep the text even if the AI step fails: discovery still reads it, and setup can finish.
    await db.update(schema.materials).set({ extracted: { text } }).where(eq(schema.materials.id, materialId));
    hasText = true;
    await assertBudget(userId);
    runId = (await startRun(userId, "resume")).id;

    const f = await completeJSON({
      name: "resume",
      schema: Fills,
      usage,
      maxTokens: 3000,
      system:
        "You read resumes and pull out facts for a job-search profile. Only use what the resume says or clearly implies. Leave a field empty rather than guess.",
      user: `<resume>\n${text}\n</resume>`,
    });

    const n = await applyFills(userId, {
      q1: f.next_role,
      area: f.area,
      modes: f.modes,
      q4: f.lead_win,
    });
    if (f.linkedin) await fillLinkedin(userId, f.linkedin);
    await addMissingLinks(userId, f.links);

    await db
      .update(schema.materials)
      .set({
        status: "done",
        scannedAt: new Date(),
        extracted: { text, summary: f.summary },
        filledNote: n ? `filled ${n} ${n === 1 ? "field" : "fields"}` : "nothing new to fill",
      })
      .where(eq(schema.materials.id, materialId));
    await finishRun(runId, usage, {});
  } catch (e) {
    console.error("scanResume", e);
    await db
      .update(schema.materials)
      .set(
        !hasText
          ? { status: "failed", filledNote: e instanceof NoTextError ? e.message : "couldn't read this file" }
          : { status: "done", scannedAt: new Date(), filledNote: "saved, couldn't auto-fill answers" },
      )
      .where(eq(schema.materials.id, materialId));
    if (runId) await finishRun(runId, usage, { error: String(e) });
  }
}

async function applyFills(userId: string, fills: Record<string, string | string[]>) {
  const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const answers = { ...(p?.answers ?? {}) };
  const auto = { ...(p?.autofilled ?? {}) };
  let n = 0;
  for (const [k, v] of Object.entries(fills)) {
    const has = Array.isArray(answers[k]) ? (answers[k] as string[]).length > 0 : !!answers[k];
    const value = Array.isArray(v) ? v.length > 0 : !!v;
    if (has || !value) continue;
    answers[k] = v;
    auto[k] = "resume";
    if (k !== "modes") n++;
  }
  await db
    .insert(schema.profiles)
    .values({ userId, answers, autofilled: auto })
    .onConflictDoUpdate({ target: schema.profiles.userId, set: { answers, autofilled: auto, updatedAt: new Date() } });
  return n;
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
    if (!url || /linkedin\.com/i.test(url) || /^(javascript|data):/i.test(url) || have.has(norm(url))) continue;
    have.add(norm(url));
    await db.insert(schema.materials).values({ userId, kind: "link", url: url.slice(0, 500), position: pos++ });
  }
}

const norm = (u: string) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
