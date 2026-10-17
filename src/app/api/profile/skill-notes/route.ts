import { eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { removeNote, upsertNote } from "@/lib/application/skills";
import { db, schema } from "@/lib/db";

/** Experience notes (#121): see, edit or forget the skills and stories added while applying. */
async function load(userId: string) {
  const [p] = await db.select({ notes: schema.profiles.skillNotes }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return p?.notes ?? [];
}

export const GET = authed(async (_req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  return json({ notes: await load(user.id) });
});

export const PUT = authed(async (req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { skill, story, forget } = await body(req, z.object({ skill: z.string().trim().min(1).max(80), story: z.string().max(1500).default(""), forget: z.boolean().optional() }));
  const notes = forget ? removeNote(await load(user.id), skill) : upsertNote(await load(user.id), skill, story);
  await db.update(schema.profiles).set({ skillNotes: notes }).where(eq(schema.profiles.userId, user.id));
  return json({ notes });
});
