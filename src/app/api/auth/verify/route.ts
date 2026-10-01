import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { body, clientIp, HttpError, json, publicRoute } from "@/lib/api";
import { hashToken } from "@/lib/auth/crypto";
import { createSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { ensureUser, mayLogIn, touchLogin } from "@/lib/users";

const Input = z.object({ token: z.string().min(20).max(100) });

// POST, not GET: mail scanners prefetch GET links and would burn the token.
export const POST = publicRoute(async (req) => {
  if (!rateLimit(`verify-ip:${await clientIp()}`, 30, 60 * 60_000)) throw new HttpError(429, "Too many attempts");
  const { token } = await body(req, Input);
  const [row] = await db
    .update(schema.loginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.loginTokens.tokenHash, hashToken(token)),
        isNull(schema.loginTokens.usedAt),
        gt(schema.loginTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) throw new HttpError(400, "This link has expired or was already used.");
  if (!(await mayLogIn(row.email))) throw new HttpError(403, "This email can't sign in.");
  const user = await ensureUser(row.email);
  await touchLogin(user.id);
  await createSession(user.id);
  return json({ ok: true });
});
