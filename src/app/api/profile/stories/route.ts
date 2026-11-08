import { eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { STORY_THEMES, removeStory, upsertStory } from "@/lib/application/stories";
import { db, schema } from "@/lib/db";

/** Personal connection stories (#155): add, edit or forget the true moments a cover letter can open with. */
async function load(userId: string) {
  const [p] = await db.select({ stories: schema.profiles.personalStories }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return p?.stories ?? [];
}

export const GET = authed(async (_req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  return json({ stories: await load(user.id) });
});

export const PUT = authed(async (req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const b = await body(
    req,
    z.union([
      z.object({ id: z.string().uuid(), forget: z.literal(true) }),
      z.object({ id: z.string().uuid().optional(), theme: z.enum(STORY_THEMES), story: z.string().trim().min(1).max(1500) }),
    ]),
  );
  const list = await load(user.id);
  if (!("forget" in b) && list.length >= 30 && !list.some((s) => s.id === b.id)) throw new HttpError(400, "That's 30 stories. Forget one to add another.");
  const stories = "forget" in b ? removeStory(list, b.id) : upsertStory(list, b);
  await db.update(schema.profiles).set({ personalStories: stories }).where(eq(schema.profiles.userId, user.id));
  return json({ stories });
});
