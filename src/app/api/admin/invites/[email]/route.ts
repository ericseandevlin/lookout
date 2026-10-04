import { and, eq, isNull } from "drizzle-orm";
import { adminRoute, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { normalizeEmail } from "@/lib/users";

type Ctx = { params: Promise<{ email: string }> };

/** Revoke an invite and any unused sign-in links for that email. Existing accounts are untouched. */
export const DELETE = adminRoute<Ctx>(async (_req, { params }) => {
  const email = normalizeEmail(decodeURIComponent((await params).email));
  await db.update(schema.invites).set({ revokedAt: new Date() }).where(eq(schema.invites.email, email));
  await db.delete(schema.loginTokens).where(and(eq(schema.loginTokens.email, email), isNull(schema.loginTokens.usedAt)));
  return json({ ok: true });
});
