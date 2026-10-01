import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { readUserFile } from "@/lib/files";
import { addUsage, assertBudget, claude, emptyUsage, finishRun, startRun } from "./claude";

const MAX_RESUME_CHARS = 60_000;

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
  try {
    const text = (await extractResumeText(await readUserFile(m.fileKey), m.mime ?? "")).slice(0, MAX_RESUME_CHARS).trim();
    if (!text) throw new Error("No text found in the file");
    await assertBudget(userId);
    runId = (await startRun(userId, "resume")).id;

    const res = await claude().beta.messages.parse({
      model: env.model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(Fills) },
      system:
        "You read resumes and pull out facts for a job-search profile. Only use what the resume says or clearly implies. Leave a field empty rather than guess.",
      messages: [{ role: "user", content: `<resume>\n${text}\n</resume>` }],
    });
    addUsage(usage, env.model, res.usage);
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("Could not read the resume");
    const f = res.parsed_output;

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
      .set({ status: "failed", filledNote: e instanceof Error ? e.message.slice(0, 120) : "Scan failed" })
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
