import { track } from "@/lib/eventStore";
import { rateLimit } from "@/lib/ratelimit";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getActiveSearch } from "@/lib/searches";

const Value = z.union([z.string().max(4000), z.array(z.string().max(100)).max(20)]);
const Input = z.object({
  answers: z.record(z.string().max(40), Value).optional(),
  /** Keys the user edited; their "Filled from" tags are cleared. */
  clearAuto: z.array(z.string().max(40)).max(20).optional(),
  save: z.boolean().optional(),
});

/** Save answers onto the active search (#8): each search has its own questions and answers. */
export const PUT = authed(async (req, { user }) => {
  const p = await body(req, Input);
  const search = await getActiveSearch(user.id);
  if (!search) throw new HttpError(409, "Create a search first.");
  const auto = { ...search.autofilled };
  for (const k of p.clearAuto ?? []) delete auto[k];
  const answers = { ...search.answers, ...(p.answers ?? {}) };
  const savedAt = p.save ? new Date() : search.savedAt;
  await db
    .update(schema.searches)
    .set({ answers, autofilled: auto, savedAt, updatedAt: new Date() })
    .where(eq(schema.searches.id, search.id));
  // Answers autosave while typing: one event per ten minutes is enough.
  if (await rateLimit(`ev-profile:${user.id}`, 1, 10 * 60_000)) await track(user.id, "profile_edit");
  return json({ ok: true, savedAt: savedAt?.toISOString() ?? null });
});
