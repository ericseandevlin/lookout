import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hashToken } from "@/lib/auth/crypto";
import { needsConsent } from "@/lib/legal";
import { findUserByEmail } from "@/lib/users";

/**
 * Whether the sign-in screen should also ask for the terms agreement (#525): the link is a live
 * login token for an onboarded account that hasn't agreed to the current versions. Read-only, so
 * the page load can't use up the token. New accounts agree on the welcome step instead.
 */
export async function consentDueFor(token: string): Promise<{ updated: boolean } | null> {
  if (token.length < 20 || token.length > 100) return null;
  const [row] = await db
    .select({ email: schema.loginTokens.email })
    .from(schema.loginTokens)
    .where(
      and(
        eq(schema.loginTokens.tokenHash, hashToken(token)),
        eq(schema.loginTokens.purpose, "login"),
        isNull(schema.loginTokens.usedAt),
        gt(schema.loginTokens.expiresAt, new Date()),
      ),
    );
  if (!row) return null;
  const user = await findUserByEmail(row.email);
  if (!user || user.disabled || !user.onboardedAt || !needsConsent(user)) return null;
  return { updated: !!user.acceptedAt };
}
