import { and, eq } from "drizzle-orm";
import { authed, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { kindOf } from "@/lib/kinds";

export const POST = authed(async (_req, { user }) => {
  // Reset each find to its own kind's first stage (#8): boards hold more than job stages now.
  const rows = await db
    .select({ opportunityId: schema.userOpportunities.opportunityId, type: schema.opportunities.type })
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(eq(schema.userOpportunities.userId, user.id));
  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx
        .update(schema.userOpportunities)
        .set({ pinned: false, archived: false, stage: kindOf(r.type).defaultStage, notes: "", seenAt: null })
        .where(
          and(
            eq(schema.userOpportunities.userId, user.id),
            eq(schema.userOpportunities.opportunityId, r.opportunityId),
          ),
        );
    }
  });
  return json({ ok: true });
});
