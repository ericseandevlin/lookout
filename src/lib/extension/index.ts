import "server-only";
import { eq } from "drizzle-orm";
import { errorResponse, HttpError } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { hashToken, newToken } from "@/lib/auth/crypto";
import type { SessionUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

/** Make a new extension token for this user, replacing any old one. Shown once; only its hash is kept. */
export async function createExtensionToken(userId: string) {
  const token = `lkx_${newToken()}`;
  await db.transaction(async (tx) => {
    await tx.delete(schema.extensionTokens).where(eq(schema.extensionTokens.userId, userId));
    await tx.insert(schema.extensionTokens).values({ tokenHash: hashToken(token), userId });
  });
  return token;
}

export async function extensionStatus(userId: string) {
  const [t] = await db.select().from(schema.extensionTokens).where(eq(schema.extensionTokens.userId, userId));
  return t ? { connected: true, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt } : { connected: false };
}

export async function revokeExtensionToken(userId: string) {
  await db.delete(schema.extensionTokens).where(eq(schema.extensionTokens.userId, userId));
}

type Handler<C> = (req: Request, ctx: C & { user: SessionUser }) => Promise<Response>;

/**
 * Routes the extension calls with `Authorization: Bearer lkx_...` instead of the session cookie.
 * No cookie is involved, so the same-origin check that guards cookie routes isn't needed here.
 * Only people who can use auto-apply get anything; everyone else sees 404.
 */
export function extensionRoute<C = object>(fn: Handler<C>) {
  return async (req: Request, ctx: C) => {
    try {
      const token = req.headers.get("authorization")?.match(/^Bearer (lkx_[\w-]{20,100})$/)?.[1];
      if (!token) throw new HttpError(401, "Connect the extension in Auto-apply settings");
      const [row] = await db
        .select({ user: schema.users })
        .from(schema.extensionTokens)
        .innerJoin(schema.users, eq(schema.users.id, schema.extensionTokens.userId))
        .where(eq(schema.extensionTokens.tokenHash, hashToken(token)));
      if (!row || row.user.disabled) throw new HttpError(401, "This extension token was replaced or revoked. Make a new one in Auto-apply settings.");
      if (!canUseAutoApply(row.user)) throw new HttpError(404, "Not found");
      await db.update(schema.extensionTokens).set({ lastUsedAt: new Date() }).where(eq(schema.extensionTokens.tokenHash, hashToken(token)));
      return await fn(req, { ...ctx, user: row.user });
    } catch (e) {
      return errorResponse(e, req);
    }
  };
}
