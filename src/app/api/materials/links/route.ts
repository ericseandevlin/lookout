import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { LinkUrl } from "@/lib/validators";

export const POST = authed(async (req, { user }) => {
  const { url } = await body(req, z.object({ url: LinkUrl }));
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.materials)
    .where(and(eq(schema.materials.userId, user.id), eq(schema.materials.kind, "link")));
  if (n >= 30) throw new HttpError(400, "That's the most links you can add.");
  const [row] = await db
    .insert(schema.materials)
    .values({ userId: user.id, kind: "link", url, position: n })
    .returning();
  return json({ link: { id: row.id, url, kind: null } });
});
