import { eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { answerKey, upsert } from "@/lib/application/saved";
import { db, schema } from "@/lib/db";

/** Saved application answers (#108): see, fix or forget them. */
async function load(userId: string) {
  const [p] = await db.select({ list: schema.profiles.applyAnswers }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return p?.list ?? [];
}

export const GET = authed(async (_req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  return json({ answers: await load(user.id) });
});

const Edit = z.object({ question: z.string().trim().min(1).max(300), answer: z.string().max(300) });

/** Save one; an empty answer forgets it. */
export const PUT = authed(async (req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { question, answer } = await body(req, Edit);
  const list = await load(user.id);
  const next = answer.trim() ? upsert(list, question, answer) : list.filter((s) => s.key !== answerKey(question));
  await db.update(schema.profiles).set({ applyAnswers: next }).where(eq(schema.profiles.userId, user.id));
  return json({ answers: next });
});
