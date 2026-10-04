import { eq } from "drizzle-orm";
import { z } from "zod";
import { adminRoute, body, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";

const Patch = z.object({ disabled: z.boolean().optional(), isAdmin: z.boolean().optional() });
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = adminRoute<Ctx>(async (req, { user, params }) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  if (id === user.id) throw new HttpError(400, "You can't change your own access here.");
  const p = await body(req, Patch);
  const r = await db.update(schema.users).set(p).where(eq(schema.users.id, id)).returning({ id: schema.users.id });
  if (!r.length) throw new HttpError(404, "Not found");
  // Disabling signs them out everywhere.
  if (p.disabled) await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
  return json({ ok: true });
});
