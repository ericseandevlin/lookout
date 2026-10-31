import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authed, HttpError, json } from "@/lib/api";
import { canUseAutoApply, setAutoApplying } from "@/lib/apply";
import { db, schema } from "@/lib/db";
import { getApplicationDetail } from "@/lib/application/review";

type Ctx = { params: Promise<{ id: string }> };

/** One application with every item and all its versions, for the review screen. */
export const GET = authed<Ctx>(async (_req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  return json(await getApplicationDetail(user.id, (await params).id));
});

/** Cancel an application that hasn't been submitted. Its drafts and versions go with it. */
export const DELETE = authed<Ctx>(async (_req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  const [a] = await db.select().from(schema.applications).where(and(eq(schema.applications.id, id), eq(schema.applications.userId, user.id)));
  if (!a) throw new HttpError(404, "Not found");
  if (a.status === "submitted" || a.status === "submitting") throw new HttpError(409, "It's already been sent, so it can't be canceled.");
  await db.delete(schema.applications).where(eq(schema.applications.id, id));
  await setAutoApplying(user.id, a.opportunityId, false);
  return json({ ok: true });
});
