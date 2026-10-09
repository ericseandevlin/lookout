import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { body, clientIp, HttpError, json, publicRoute } from "@/lib/api";
import { hashToken } from "@/lib/auth/crypto";
import { db, schema } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { findUserByEmail } from "@/lib/users";

const Input = z.object({ token: z.string().min(20).max(100) });

/** Finish an email change. Proves the person controls the new address. */
export const POST = publicRoute(async (req) => {
  if (!rateLimit(`confirm-email:${await clientIp()}`, 30, 60 * 60_000)) throw new HttpError(429, "Too many attempts");
  const { token } = await body(req, Input);
  const [row] = await db
    .update(schema.loginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.loginTokens.tokenHash, hashToken(token)),
        eq(schema.loginTokens.purpose, "email_change"),
        isNull(schema.loginTokens.usedAt),
        gt(schema.loginTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row?.userId) throw new HttpError(400, "This link has expired or was already used.");
  const taken = await findUserByEmail(row.email);
  if (taken && taken.id !== row.userId) throw new HttpError(409, "That email now belongs to another account.");
  const [old] = await db.select().from(schema.users).where(eq(schema.users.id, row.userId));
  await db.update(schema.users).set({ email: row.email }).where(eq(schema.users.id, row.userId));
  // Sign-in links still pointing at the old address stop working.
  if (old) await db.delete(schema.loginTokens).where(and(eq(schema.loginTokens.email, old.email), isNull(schema.loginTokens.usedAt)));
  return json({ ok: true, email: row.email });
});
