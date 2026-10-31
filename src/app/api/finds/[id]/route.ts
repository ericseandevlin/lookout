import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { ENDED_STAGES } from "@/lib/board";
import { db, schema } from "@/lib/db";
import { STAGES } from "@/lib/db/schema";

const Patch = z.object({
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  stage: z.enum(STAGES).optional(),
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
  const { seen, feedback, ...rest } = p;
  const set: Partial<typeof schema.userOpportunities.$inferInsert> = { ...rest };
  // An ended stage archives the find, whichever client set it (#180). Leaving one does not unarchive it; Restore does.
  if (rest.stage && ENDED_STAGES.includes(rest.stage)) set.archived = true;
  if (feedback !== undefined) set.feedback = feedback ? { reason: feedback, at: new Date().toISOString() } : null;
  // Any interaction marks the find as seen, like opening it does.
  if (seen || Object.keys(rest).length || feedback !== undefined) set.seenAt = new Date();
  const where = and(eq(schema.userOpportunities.userId, user.id), eq(schema.userOpportunities.opportunityId, id));
  const updated = await db.update(schema.userOpportunities).set(set).where(where).returning({ id: schema.userOpportunities.opportunityId });
  if (!updated.length) throw new HttpError(404, "Not found");
  return json({ ok: true });
});
