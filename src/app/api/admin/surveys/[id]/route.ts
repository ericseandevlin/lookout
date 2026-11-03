import { z } from "zod";
import { adminRoute, body, HttpError, json } from "@/lib/api";
import { answersCsv } from "@/lib/survey";
import { answersFor, setActive } from "@/lib/surveyStore";

type Ctx = { params: Promise<{ id: string }> };

const idOf = async (params: Ctx["params"]) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  return id;
};

/** Answers to one question with person and date; ?format=csv downloads them. */
export const GET = adminRoute<Ctx>(async (req, { params }) => {
  const { question, rows } = await answersFor(await idOf(params));
  if (new URL(req.url).searchParams.get("format") === "csv")
    return new Response(answersCsv(question.prompt, rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="survey-${question.id.slice(0, 8)}.csv"`, "Cache-Control": "no-store" },
    });
  return json({ rows: rows.map((r) => ({ ...r, at: r.at.toISOString() })) });
});

export const PATCH = adminRoute<Ctx>(async (req, { params }) => {
  const { active } = await body(req, z.object({ active: z.boolean() }));
  await setActive(await idOf(params), active);
  return json({ ok: true });
});
