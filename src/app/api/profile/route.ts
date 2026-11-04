import { eq } from "drizzle-orm";
import { track } from "@/lib/eventStore";
import { rateLimit } from "@/lib/ratelimit";
import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { db, schema } from "@/lib/db";

const Value = z.union([z.string().max(4000), z.array(z.string().max(100)).max(20)]);
const Input = z.object({
  answers: z.record(z.string().max(40), Value).optional(),
  /** Keys the user edited; their "Filled from" tags are cleared. */
  clearAuto: z.array(z.string().max(40)).max(20).optional(),
  save: z.boolean().optional(),
});

export const PUT = authed(async (req, { user }) => {
  const p = await body(req, Input);
  const [row] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const auto = { ...(row?.autofilled ?? {}) };
  for (const k of p.clearAuto ?? []) delete auto[k];
  const answers = { ...(row?.answers ?? {}), ...(p.answers ?? {}) };
  const savedAt = p.save ? new Date() : (row?.savedAt ?? null);
  await db
    .insert(schema.profiles)
    .values({ userId: user.id, answers, autofilled: auto, savedAt })
    .onConflictDoUpdate({ target: schema.profiles.userId, set: { answers, autofilled: auto, savedAt, updatedAt: new Date() } });
  // Answers autosave while typing: one event per ten minutes is enough.
  if (await rateLimit(`ev-profile:${user.id}`, 1, 10 * 60_000)) await track(user.id, "profile_edit");
  return json({ ok: true, savedAt: savedAt?.toISOString() ?? null });
});
