import "server-only";
import { and, asc, count, desc, eq, max, notExists, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { getSurveyConfig } from "@/lib/config";
import type { SurveyKind } from "@/lib/db/schema";
import { cleanAnswer, cleanOptions, isDue, type SurveyQuestion } from "./survey";

/**
 * The question to show this person now, or null. New accounts count from the day they joined,
 * so nobody gets a survey in their first N days.
 */
export async function nextQuestion(user: { id: string; createdAt: Date }): Promise<SurveyQuestion | null> {
  const { everyDays } = await getSurveyConfig();
  const [{ last }] = await db.select({ last: max(schema.surveyAnswers.createdAt) }).from(schema.surveyAnswers).where(eq(schema.surveyAnswers.userId, user.id));
  if (!isDue(last ?? user.createdAt, everyDays)) return null;
  const [q] = await db
    .select({ id: schema.surveyQuestions.id, kind: schema.surveyQuestions.kind, prompt: schema.surveyQuestions.prompt, options: schema.surveyQuestions.options })
    .from(schema.surveyQuestions)
    .where(
      and(
        eq(schema.surveyQuestions.active, true),
        // A question about the email goes only to people who get it (#514).
        or(eq(schema.surveyQuestions.onlyIfDigest, false), sql`coalesce((select ${schema.settings.digest} from ${schema.settings} where ${schema.settings.userId} = ${user.id}), true)`),
        notExists(db.select({ one: sql`1` }).from(schema.surveyAnswers).where(and(eq(schema.surveyAnswers.questionId, schema.surveyQuestions.id), eq(schema.surveyAnswers.userId, user.id)))),
      ),
    )
    .orderBy(asc(schema.surveyQuestions.createdAt))
    .limit(1);
  return q ?? null;
}

/** Record an answer, or a skip (null). A second reply to the same question is ignored. */
export async function answer(userId: string, questionId: string, raw: string | null) {
  const [q] = await db.select().from(schema.surveyQuestions).where(eq(schema.surveyQuestions.id, questionId));
  if (!q?.active) throw new HttpError(404, "That question isn't open anymore.");
  let value: string | null;
  try {
    value = cleanAnswer(q, raw);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  await db.insert(schema.surveyAnswers).values({ questionId, userId, answer: value }).onConflictDoNothing();
}

// --- Admin

export async function listQuestions() {
  const qs = await db.select().from(schema.surveyQuestions).orderBy(desc(schema.surveyQuestions.createdAt));
  const counts = await db
    .select({ id: schema.surveyAnswers.questionId, n: count(), skipped: sql<number>`count(*) filter (where ${schema.surveyAnswers.answer} is null)` })
    .from(schema.surveyAnswers)
    .groupBy(schema.surveyAnswers.questionId);
  const by = new Map(counts.map((c) => [c.id, c]));
  return qs.map((q) => ({ id: q.id, kind: q.kind, prompt: q.prompt, options: q.options, active: q.active, createdAt: q.createdAt.toISOString(), answers: Number(by.get(q.id)?.n ?? 0) - Number(by.get(q.id)?.skipped ?? 0), skipped: Number(by.get(q.id)?.skipped ?? 0) }));
}

export async function createQuestion(p: { kind: SurveyKind; prompt: string; options: string[] }) {
  let options: string[];
  try {
    options = cleanOptions(p.kind, p.options);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const [q] = await db.insert(schema.surveyQuestions).values({ kind: p.kind, prompt: p.prompt.trim(), options }).returning();
  return q;
}

export async function setActive(id: string, active: boolean) {
  const r = await db.update(schema.surveyQuestions).set({ active }).where(eq(schema.surveyQuestions.id, id)).returning({ id: schema.surveyQuestions.id });
  if (!r.length) throw new HttpError(404, "Not found");
}

/** Every reply to one question, newest first, with who and when. */
export async function answersFor(id: string) {
  const [q] = await db.select().from(schema.surveyQuestions).where(eq(schema.surveyQuestions.id, id));
  if (!q) throw new HttpError(404, "Not found");
  const rows = await db
    .select({ email: schema.users.email, name: schema.users.name, answer: schema.surveyAnswers.answer, at: schema.surveyAnswers.createdAt })
    .from(schema.surveyAnswers)
    .innerJoin(schema.users, eq(schema.users.id, schema.surveyAnswers.userId))
    .where(eq(schema.surveyAnswers.questionId, id))
    .orderBy(desc(schema.surveyAnswers.createdAt));
  return { question: q, rows };
}

