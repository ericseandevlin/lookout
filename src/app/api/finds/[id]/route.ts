import { and, eq } from "drizzle-orm";
import { track } from "@/lib/eventStore";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { kindOf } from "@/lib/kinds";

const Patch = z.object({
  /** Which search's board this find is on (#8); the same posting can sit on two boards. */
  searchId: z.string().uuid().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  /** Which stage depends on the find's kind (#8); validated against its kind's stages below. */
  stage: z.string().trim().min(1).max(40).optional(),
  notes: z.string().max(20_000).optional(),
  seen: z.literal(true).optional(),
  /** "Not a fit" reason; null clears it (e.g. on restore). */
  feedback: z.string().trim().max(80).nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = authed<Ctx>(async (req, { user, params }) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  const p = await body(req, Patch);
  const { seen, feedback, searchId, ...rest } = p;
  const set: Partial<typeof schema.userOpportunities.$inferInsert> = { ...rest };
  // A stage must be one its kind's stages, and an ended stage archives the find,
  // whichever client set it (#180, #8). Leaving one does not unarchive it; Restore does.
  if (rest.stage) {
    const [opp] = await db
      .select({ type: schema.opportunities.type })
      .from(schema.opportunities)
      .where(eq(schema.opportunities.id, id));
    const cfg = kindOf(opp?.type);
    if (!cfg.stages.includes(rest.stage)) throw new HttpError(400, "Not a stage for this find.");
    if (cfg.endedStages.includes(rest.stage)) set.archived = true;
  }
  if (feedback !== undefined) set.feedback = feedback ? { reason: feedback, at: new Date().toISOString() } : null;
  // Any interaction marks the find as seen, like opening it does.
  if (seen || Object.keys(rest).length || feedback !== undefined) set.seenAt = new Date();
  // The board is per search (#8): scope to that board when the client names it.
  const where = and(
    eq(schema.userOpportunities.userId, user.id),
    eq(schema.userOpportunities.opportunityId, id),
    ...(searchId ? [eq(schema.userOpportunities.searchId, searchId)] : []),
  );
  const updated = await db.update(schema.userOpportunities).set(set).where(where).returning({ id: schema.userOpportunities.opportunityId });
  if (!updated.length) throw new HttpError(404, "Not found");
  if (rest.pinned !== undefined) await track(user.id, "pin", id, { on: rest.pinned });
  if (rest.stage) await track(user.id, "stage_change", id, { stage: rest.stage });
  if (feedback) await track(user.id, "not_a_fit", id, { reason: feedback });
  return json({ ok: true });
});
