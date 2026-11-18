import { and, eq, isNull } from "drizzle-orm";
import { HttpError, json, publicRoute } from "@/lib/api";
import { secrets } from "@/lib/bulkMail";
import { db, schema } from "@/lib/db";
import { readConfirmToken } from "@/lib/waitlist";

/**
 * Double opt-in (#9): the /waitlist/confirm page posts here with the token from the email.
 * GET does nothing, so link scanners in mail apps can't confirm anyone. Confirming twice is fine.
 */
export const POST = publicRoute(async (req) => {
  const email = readConfirmToken(new URL(req.url).searchParams.get("t") ?? "", secrets());
  if (!email) throw new HttpError(400, "That confirm link isn't valid or has expired. Ask again from the waitlist form.");
  const [row] = await db.select({ email: schema.accessRequests.email }).from(schema.accessRequests).where(eq(schema.accessRequests.email, email));
  if (!row) throw new HttpError(404, "We couldn't find that request. Ask again from the waitlist form.");
  await db
    .update(schema.accessRequests)
    .set({ confirmedAt: new Date() })
    .where(and(eq(schema.accessRequests.email, email), isNull(schema.accessRequests.confirmedAt)));
  return json({ ok: true });
});
