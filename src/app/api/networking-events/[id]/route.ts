import { featureOn } from "@/lib/features";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";

const Patch = z
  .object({ dismissed: z.boolean(), pinned: z.boolean(), archived: z.boolean() })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Nothing to change");

type Ctx = { params: Promise<{ id: string }> };

/** "Not for me" hides an event for good (the same event isn't added again); pin and archive are for the board (#265). */
export const PATCH = authed<Ctx>(async (req, { user, params }) => {
  if (!featureOn("EVENTS")) throw new HttpError(404, "Not found");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  const patch = await body(req, Patch);
  const updated = await db
    .update(schema.networkingEvents)
    .set(patch)
    .where(and(eq(schema.networkingEvents.userId, user.id), eq(schema.networkingEvents.id, id)))
    .returning({ id: schema.networkingEvents.id });
  if (!updated.length) throw new HttpError(404, "Not found");
  return json({ ok: true });
});
