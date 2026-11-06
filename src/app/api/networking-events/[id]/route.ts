import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";

const Patch = z.object({ dismissed: z.boolean() });

type Ctx = { params: Promise<{ id: string }> };

/** "Not for me" on an event hides it; the same event isn't added again. */
export const PATCH = authed<Ctx>(async (req, { user, params }) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  const { dismissed } = await body(req, Patch);
  const updated = await db
    .update(schema.networkingEvents)
    .set({ dismissed })
    .where(and(eq(schema.networkingEvents.userId, user.id), eq(schema.networkingEvents.id, id)))
    .returning({ id: schema.networkingEvents.id });
  if (!updated.length) throw new HttpError(404, "Not found");
  return json({ ok: true });
});
