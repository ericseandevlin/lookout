import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { featureOn } from "@/lib/features";
import { answerKeywordQuestion, keywordQuestions } from "@/lib/interview/keywords";
import { rateLimit } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ id: string }> };

const Input = z.discriminatedUnion("action", [
  /** The open questions, grouping any missing keyword no question covers yet. */
  z.object({ action: z.literal("questions") }),
  z.object({ action: z.enum(["answer", "skip"]), question: z.string().min(1).max(20), text: z.string().max(4000).default("") }),
]);

/** The interview for this resume's missing keywords (#1485), behind FEATURE_INTERVIEW. */
export const POST = authed<Ctx>(async (req, { user, params }) => {
  if (!featureOn("INTERVIEW") || !canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const id = (await params).id;
  const p = await body(req, Input);
  if (p.action === "questions") return json(await keywordQuestions(user.id, id));
  if (!(await rateLimit(`interview:${user.id}`, 30, 10 * 60_000))) throw new HttpError(429, "That's a lot of answers in a few minutes. Take a short break and come back.");
  return json(await answerKeywordQuestion(user.id, id, p.question, p.action, p.text));
});
