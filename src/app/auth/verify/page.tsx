import { and, eq, gt, isNull } from "drizzle-orm";
import { Verify } from "@/components/Verify";
import { db, schema } from "@/lib/db";
import { hashToken } from "@/lib/auth/crypto";
import { needsConsent } from "@/lib/legal";
import { findUserByEmail } from "@/lib/users";

export const metadata = { referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

/**
 * The sign-in tap (#525). Reads the token without using it, to know whether this is an existing account that still
 * has to agree to the current Terms and Privacy. If so, the same screen asks, and one Continue does both.
 * New accounts agree on the welcome step instead.
 */
async function mustAgree(token: string) {
  if (token.length < 20 || token.length > 100) return false;
  const [row] = await db
    .select({ email: schema.loginTokens.email })
    .from(schema.loginTokens)
    .where(and(eq(schema.loginTokens.tokenHash, hashToken(token)), eq(schema.loginTokens.purpose, "login"), isNull(schema.loginTokens.usedAt), gt(schema.loginTokens.expiresAt, new Date())));
  if (!row) return false;
  const user = await findUserByEmail(row.email);
  return !!user && !!user.onboardedAt && needsConsent(user);
}

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const t = typeof token === "string" ? token : "";
  return (
    <main>
      <Verify token={t} agreeFirst={await mustAgree(t)} />
    </main>
  );
}
