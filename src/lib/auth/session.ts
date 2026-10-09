import "server-only";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { hashToken, newToken } from "./crypto";

export const SESSION_COOKIE = "lookout_session";
// Rolling: every signed-in request (at most once a day) pushes expiry out to 90 days again.
const SESSION_DAYS = 90;

export type SessionUser = typeof schema.users.$inferSelect;

export async function createSession(userId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db.insert(schema.sessions).values({ idHash: hashToken(token), userId, expiresAt, userAgent: ua, lastSeenAt: new Date() });
  await setCookie(token, expiresAt);
}

async function setCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Slide the session forward. Call only where cookies can be written (route handlers). */
export async function refreshSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  const fresh = new Date(Date.now() + SESSION_DAYS * 864e5);
  const dayAgoCutoff = new Date(fresh.getTime() - 864e5);
  const r = await db
    .update(schema.sessions)
    .set({ expiresAt: fresh, lastSeenAt: new Date() })
    .where(and(eq(schema.sessions.idHash, hashToken(token)), gt(schema.sessions.expiresAt, new Date()), lt(schema.sessions.expiresAt, dayAgoCutoff)))
    .returning({ id: schema.sessions.idHash });
  if (r.length) await setCookie(token, fresh);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.idHash, hashToken(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const user = rows[0]?.user;
  if (!user || user.disabled) return null;
  return user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.idHash, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

/** Hash of the current session, to mark "this device" and keep it on "sign out everywhere else". */
export async function currentSessionHash() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}
