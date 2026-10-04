import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getAccessConfig } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export async function findUserByEmail(email: string) {
  const rows = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${normalizeEmail(email)}`)
    .limit(1);
  return rows[0] ?? null;
}

export async function mayLogIn(email: string) {
  const e = normalizeEmail(email);
  const existing = await findUserByEmail(e);
  if (existing) return !existing.disabled;
  if ((await getAccessConfig()).signupMode === "open") return true;
  if (env.allowedEmails.includes(e) || env.adminEmails.includes(e)) return true;
  const [inv] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.email, e), isNull(schema.invites.revokedAt)));
  return !!inv;
}

/** Create the user plus default settings/profile rows. Idempotent on email. */
export async function ensureUser(email: string) {
  const e = normalizeEmail(email);
  const existing = await findUserByEmail(e);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({ email: e, isAdmin: env.adminEmails.includes(e) })
      .returning();
    await tx.insert(schema.settings).values({ userId: user.id });
    await tx.insert(schema.profiles).values({ userId: user.id });
    return user;
  });
}

export const isAdmin = (u: { isAdmin: boolean; email: string }) =>
  u.isAdmin || env.adminEmails.includes(normalizeEmail(u.email));

export async function touchLogin(userId: string) {
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, userId));
}
