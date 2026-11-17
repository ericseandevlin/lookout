import { asc } from "drizzle-orm";
import { adminRoute } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { waitlistCsv } from "@/lib/waitlist";

/** Every waitlist request, pending or decided, as a CSV download (#9). Oldest first. */
export const GET = adminRoute(async () => {
  const rows = await db.select().from(schema.accessRequests).orderBy(asc(schema.accessRequests.createdAt));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(waitlistCsv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="waitlist-${day}.csv"`, "Cache-Control": "no-store" },
  });
});
