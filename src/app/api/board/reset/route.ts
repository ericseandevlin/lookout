import { and, eq } from "drizzle-orm";
import { authed, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { kindOf } from "@/lib/kinds";
import { getActiveSearch } from "@/lib/searches";

/** Reset the active search's board (#8): each find back to its own kind's first stage. */
export const POST = authed(async (_req, { user }) => {
  const search = await getActiveSearch(user.id);
  if (!search) throw new HttpError(409, "Create a search first.");
  const rows = await db
    .select({ opportunityId: schema.userOpportunities.opportunityId, type: schema.opportunities.type })
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(eq(schema.userOpportunities.searchId, search.id));
  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx
        .update(schema.userOpportunities)
        .set({ pinned: false, archived: false, stage: kindOf(r.type).defaultStage, notes: "", seenAt: null })
        .where(
          and(
            eq(schema.userOpportunities.searchId, search.id),
            eq(schema.userOpportunities.opportunityId, r.opportunityId),
          ),
        );
    }
  });
  return json({ ok: true });
});
