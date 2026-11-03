import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { answer, nextQuestion } from "@/lib/surveyStore";

/** The one survey question due for this person now, if any (#5). */
export const GET = authed(async (_req, { user }) => json({ question: await nextQuestion(user) }));

const Input = z.object({ questionId: z.string().uuid(), answer: z.string().max(5000).nullable() });

/** Answer it, or skip it with answer: null. */
export const POST = authed(async (req, { user }) => {
  const p = await body(req, Input);
  await answer(user.id, p.questionId, p.answer);
  return json({ ok: true });
});
