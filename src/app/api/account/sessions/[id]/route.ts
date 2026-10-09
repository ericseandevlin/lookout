import { and, eq, like, ne } from "drizzle-orm";
import { authed, HttpError, json } from "@/lib/api";
import { currentSessionHash } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

/** Sign out one device by its short id, or every other device with id "others". */
export const DELETE = authed<Ctx>(async (_req, { user, params }) => {
  const { id } = await params;
  const current = await currentSessionHash();
  if (id === "others") {
    if (!current) throw new HttpError(400, "No current session");
    await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.idHash, current)));
    return json({ ok: true });
  }
  if (!/^[0-9a-f]{16}$/.test(id)) throw new HttpError(404, "Not found");
  await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), like(schema.sessions.idHash, `${id}%`)));
  return json({ ok: true, signedOutHere: current?.startsWith(id) ?? false });
});
