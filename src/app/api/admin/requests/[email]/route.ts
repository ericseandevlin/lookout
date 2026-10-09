import { eq } from "drizzle-orm";
import { z } from "zod";
import { adminRoute, body, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { createInvite } from "@/lib/invite";
import { normalizeEmail } from "@/lib/users";

type Ctx = { params: Promise<{ email: string }> };
const Input = z.object({ decision: z.enum(["approve", "decline"]), send: z.boolean().optional() });

/** Approve (creates the invite and its link) or decline an access request. */
export const POST = adminRoute<Ctx>(async (req, { user, params }) => {
  const email = normalizeEmail(decodeURIComponent((await params).email));
  const p = await body(req, Input);
  const [r] = await db.select().from(schema.accessRequests).where(eq(schema.accessRequests.email, email));
  if (!r) throw new HttpError(404, "No request from that email");
  await db
    .update(schema.accessRequests)
    .set({ status: p.decision === "approve" ? "approved" : "declined", decidedAt: new Date(), decidedBy: user.id })
    .where(eq(schema.accessRequests.email, email));
  if (p.decision === "decline") return json({ ok: true });
  return json(await createInvite(email, user, !!p.send));
});
