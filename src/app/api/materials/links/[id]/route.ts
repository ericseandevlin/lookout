import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { LINK_KINDS } from "@/lib/links";
import { LinkUrl } from "@/lib/validators";
import { readLink } from "@/lib/agent/links";

type Ctx = { params: Promise<{ id: string }> };

const whereLink = (userId: string, id: string) =>
  and(eq(schema.materials.id, id), eq(schema.materials.userId, userId), eq(schema.materials.kind, "link"));

const Patch = z.object({ url: LinkUrl.optional(), kind: z.enum(LINK_KINDS).nullable().optional() });

export const PATCH = authed<Ctx>(async (req, { user, params }) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  const p = await body(req, Patch);
  const set: Partial<typeof schema.materials.$inferInsert> = {};
  if (p.url !== undefined) set.url = p.url;
  if (p.kind !== undefined) set.linkKind = p.kind;
  // Nothing to change: an empty update is a SQL error, so just confirm the link is theirs (#461).
  const r = Object.keys(set).length
    ? await db.update(schema.materials).set(set).where(whereLink(user.id, id)).returning({ id: schema.materials.id })
    : await db.select({ id: schema.materials.id }).from(schema.materials).where(whereLink(user.id, id));
  if (!r.length) throw new HttpError(404, "Not found");
  if (p.url) void readLink(id, p.url).catch((e) => console.error("link read failed", e));
  return json({ ok: true });
});

export const DELETE = authed<Ctx>(async (_req, { user, params }) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  await db.delete(schema.materials).where(whereLink(user.id, id));
  return json({ ok: true });
});
