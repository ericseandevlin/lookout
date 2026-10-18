import { eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply, getAutoApplySettings } from "@/lib/apply";
import { emptyUsage } from "@/lib/ai/llm";
import { assertBudget } from "@/lib/ai/runs";
import { ensureMaster, saveMaster } from "@/lib/application/master";
import { db, schema } from "@/lib/db";

/** The master resume as Lookout reads it (#131): built once from the upload, fixable by the person. */
export const GET = authed(async (_req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const [p] = await db.select({ m: schema.profiles.masterResume }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  if (!p?.m) await assertBudget(user.id);
  const r = await ensureMaster(user.id, emptyUsage());
  const [after] = await db.select({ m: schema.profiles.masterResume }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  return json({ md: r?.md ?? null, edited: !!after?.m?.edited, at: after?.m?.at ?? null, uncertain: after?.m?.uncertain ?? [], template: (await getAutoApplySettings(user.id)).template ?? "modern", accent: (await getAutoApplySettings(user.id)).accent ?? null });
});

export const PUT = authed(async (req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { md } = await body(req, z.object({ md: z.string().trim().min(40).max(40000) }));
  const m = await saveMaster(user.id, md);
  return json({ md: m.md, edited: true, at: m.at, uncertain: [] });
});
