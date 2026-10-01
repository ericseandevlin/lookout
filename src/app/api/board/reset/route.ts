import { eq } from "drizzle-orm";
import { authed, json } from "@/lib/api";
import { db, schema } from "@/lib/db";

export const POST = authed(async (_req, { user }) => {
  await db
    .update(schema.userOpportunities)
    .set({ pinned: false, archived: false, stage: "Not applied", notes: "", seenAt: null })
    .where(eq(schema.userOpportunities.userId, user.id));
  return json({ ok: true });
});
