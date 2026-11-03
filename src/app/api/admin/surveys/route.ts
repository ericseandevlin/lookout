import { z } from "zod";
import { adminRoute, body, json } from "@/lib/api";
import { getSurveyConfig, saveConfig, SurveyConfigSchema } from "@/lib/config";
import { SURVEY_KINDS } from "@/lib/db/schema";
import { createQuestion, listQuestions } from "@/lib/surveyStore";

const state = async () => ({ questions: await listQuestions(), config: await getSurveyConfig() });

/** Survey questions with answer counts, and how often people are asked (#5). */
export const GET = adminRoute(async () => json(await state()));

const Create = z.object({ kind: z.enum(SURVEY_KINDS), prompt: z.string().trim().min(3).max(300), options: z.array(z.string().max(200)).max(20).default([]) });

export const POST = adminRoute(async (req) => {
  await createQuestion(await body(req, Create));
  return json(await state());
});

export const PUT = adminRoute(async (req) => {
  await saveConfig("survey", await body(req, SurveyConfigSchema));
  return json(await state());
});
