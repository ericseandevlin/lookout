import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Fills } from "./resume";
import type { z } from "zod";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

// The file is a .docx whose text is whatever the test sets.
let resumeText = "";
vi.mock("@/lib/files", () => ({ readUserFile: vi.fn(async () => Buffer.from("docx")) }));
vi.mock("mammoth", () => ({ convertToHtml: vi.fn(async () => ({ value: resumeText })) }));
const readLink = vi.fn(async () => {});
vi.mock("./links", () => ({ readLink }));

type FillsT = z.infer<typeof Fills>;
const fills = (over: Partial<FillsT> = {}): FillsT => ({
  summary: "Design leader.",
  next_role: "VP of Design",
  area: "New York, NY",
  modes: ["Hybrid"],
  linkedin: "",
  lead_win: "I grew the team from 3 to 20.",
  links: [],
  ...over,
});
const completeJSON = vi.fn(async (): Promise<FillsT> => fills());
vi.mock("@/lib/ai/llm", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/llm")>()), completeJSON }));
let provider = "openrouter";
vi.mock("@/lib/config", async (orig) => {
  const real = await orig<typeof import("@/lib/config")>();
  return { ...real, getAiConfig: async () => ({ ...(await real.getAiConfig()), provider }) };
});

const { applyResumeResult, scanResume } = await import("./resume");
const { AiConfigError } = await import("@/lib/ai/llm");

let userId: string;
let searchId: string;
let materialId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  completeJSON.mockClear();
  readLink.mockClear();
  provider = "openrouter";
  resumeText = "Pat Lee. Design Director at Acme. Grew the team from 3 to 20.";
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.delete(schema.runs);
  await db.delete(schema.users);
  [{ id: userId }] = await db.insert(schema.users).values({ email: "me@example.com", name: "Pat Lee" }).returning();
  [{ id: searchId }] = await db.insert(schema.searches).values({ userId, name: "Job search", answers: { q1: "Head of Design" } }).returning();
  [{ id: materialId }] = await db.insert(schema.materials).values({ userId, kind: "resume", fileKey: "u/cv.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }).returning();
});

const material = async (id = materialId) => (await db.select().from(schema.materials).where(eq(schema.materials.id, id)))[0];
const search = async () => (await db.select().from(schema.searches).where(eq(schema.searches.id, searchId)))[0];
const others = async (kind: "link" | "linkedin") => (await db.select().from(schema.materials).where(eq(schema.materials.userId, userId))).filter((m) => m.kind === kind);

describe("scanResume", () => {
  it("fills empty answers and never overwrites the person's own", async () => {
    await scanResume(userId, materialId);
    const s = await search();
    expect(s.answers).toMatchObject({ q1: "Head of Design", area: "New York, NY", modes: ["Hybrid"], q4: "I grew the team from 3 to 20." });
    expect(s.autofilled).toEqual({ area: "resume", modes: "resume", q4: "resume" });
    const m = await material();
    expect(m.status).toBe("done");
    expect(m.extracted).toEqual({ text: resumeText, summary: "Design leader." });
    expect(m.filledNote).toBe("filled where you work, work modes, lead win");
    const [run] = await db.select().from(schema.runs).where(eq(schema.runs.userId, userId));
    expect(run).toMatchObject({ trigger: "resume", status: "done" });
  });

  it("marks a file with no text as failed and doesn't call the model", async () => {
    resumeText = "   ";
    await scanResume(userId, materialId);
    expect(await material()).toMatchObject({ status: "failed", filledNote: "no readable text in this file" });
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it("queues the job for the external agent instead of calling the model", async () => {
    provider = "agent";
    await scanResume(userId, materialId);
    expect(completeJSON).not.toHaveBeenCalled();
    const [run] = await db.select().from(schema.runs).where(eq(schema.runs.userId, userId));
    expect(run).toMatchObject({ trigger: "resume", status: "queued", request: { type: "resume", materialId } });
    expect(await material()).toMatchObject({ status: "done", filledNote: "saved, auto-fill is queued", extracted: { text: resumeText } });
  });

  it("keeps the text and says the AI isn't set up when it isn't", async () => {
    completeJSON.mockRejectedValueOnce(new AiConfigError("No AI model is set."));
    await scanResume(userId, materialId);
    const m = await material();
    expect(m).toMatchObject({ status: "done", extracted: { text: resumeText } });
    expect(m.filledNote).toBe("saved, but auto-fill didn't run (the AI isn't set up)");
    const [run] = await db.select().from(schema.runs).where(eq(schema.runs.userId, userId));
    expect(run.status).toBe("failed");
  });

  it("says when the daily AI limit stopped auto-fill", async () => {
    await db.insert(schema.runs).values({ userId, trigger: "manual", status: "done", costUsd: "999" });
    await scanResume(userId, materialId);
    expect(completeJSON).not.toHaveBeenCalled();
    expect((await material()).filledNote).toBe("saved, but auto-fill didn't run (today's AI limit is used up, try again tomorrow)");
  });

  it("says the AI step failed when the model call breaks", async () => {
    completeJSON.mockRejectedValueOnce(new Error("upstream 502"));
    await scanResume(userId, materialId);
    expect((await material()).filledNote).toBe("saved, but auto-fill didn't run (the AI step failed, try uploading again later)");
  });
});

describe("applyResumeResult", () => {
  it("says so when there was nothing new to fill", async () => {
    await db.update(schema.searches).set({ answers: { q1: "a", area: "b", modes: ["Remote"], q4: "c" } }).where(eq(schema.searches.id, searchId));
    expect(await applyResumeResult(userId, materialId, fills())).toEqual([]);
    expect((await material()).filledNote).toBe("nothing new to fill, your answers were already set");
  });

  it("saves the LinkedIn handle once, only when there's no LinkedIn yet", async () => {
    await applyResumeResult(userId, materialId, fills({ linkedin: "https://www.linkedin.com/in/patlee/" }));
    expect((await others("linkedin")).map((m) => m.url)).toEqual(["patlee"]);
    await applyResumeResult(userId, materialId, fills({ linkedin: "someone-else" }));
    expect((await others("linkedin")).map((m) => m.url)).toEqual(["patlee"]);
  });

  it("adds new links and skips LinkedIn, scripts and ones already there", async () => {
    await db.insert(schema.materials).values({ userId, kind: "link", url: "https://patlee.design/" });
    await applyResumeResult(
      userId,
      materialId,
      fills({ links: ["http://www.PatLee.design", "https://linkedin.com/in/patlee", "javascript:alert(1)", "https://github.com/patlee", "https://github.com/patlee/"] }),
    );
    expect((await others("link")).map((m) => m.url).sort()).toEqual(["https://github.com/patlee", "https://patlee.design/"]);
    expect(readLink).toHaveBeenCalledTimes(1);
    expect(readLink).toHaveBeenCalledWith(expect.any(String), "https://github.com/patlee");
  });

  it("reads links the resume lists without https:// and skips mail and phone links (#664)", async () => {
    await applyResumeResult(userId, materialId, fills({ links: ["patlee.design/work", "mailto:pat@lee.design", "tel:5551234"] }));
    expect((await others("link")).map((m) => m.url)).toEqual(["patlee.design/work"]);
    expect(readLink).toHaveBeenCalledTimes(1);
    expect(readLink).toHaveBeenCalledWith(expect.any(String), "patlee.design/work");
  });
});
