import { and, eq, isNull } from "drizzle-orm";
import { track } from "@/lib/eventStore";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { forwardTo } from "@/lib/digestLinks";
import { env } from "@/lib/env";

type Ctx = { params: Promise<{ digest: string; target: string }> };
const uuid = z.string().uuid();

/**
 * A link clicked in a digest email (#34): record it once, mark the find as seen, and forward to the
 * posting (or the board). No sign-in needed; the destination comes from the database.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { digest, target } = await params;
  const board = `${env.appUrl}/finds`;
  if (!uuid.safeParse(digest).success || (target !== "board" && !uuid.safeParse(target).success)) return Response.redirect(board, 302);
  try {
    const [d] = await db.select().from(schema.digests).where(eq(schema.digests.id, digest));
    if (!d) return Response.redirect(board, 302);
    if (target === "board") {
      const [seen] = await db.select({ id: schema.digestClicks.id }).from(schema.digestClicks).where(and(eq(schema.digestClicks.digestId, d.id), isNull(schema.digestClicks.opportunityId)));
      if (!seen) await db.insert(schema.digestClicks).values({ digestId: d.id });
      await track(d.userId, "email_click", "board");
      return Response.redirect(board, 302);
    }
    const [row] = await db
      .select({ url: schema.opportunities.sourceUrl, seenAt: schema.userOpportunities.seenAt })
      .from(schema.userOpportunities)
      .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
      .where(and(eq(schema.userOpportunities.userId, d.userId), eq(schema.userOpportunities.opportunityId, target)));
    if (!row) return Response.redirect(board, 302);
    await db.insert(schema.digestClicks).values({ digestId: d.id, opportunityId: target }).onConflictDoNothing();
    await track(d.userId, "email_click", target);
    if (!row.seenAt) await db.update(schema.userOpportunities).set({ seenAt: new Date() }).where(and(eq(schema.userOpportunities.userId, d.userId), eq(schema.userOpportunities.opportunityId, target)));
    return Response.redirect(forwardTo(row.url, env.appUrl), 302);
  } catch (e) {
    // A click should always land somewhere, even if recording it failed.
    console.error("[go] click not recorded", e);
    return Response.redirect(board, 302);
  }
}
