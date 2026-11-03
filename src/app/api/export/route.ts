import { asc, eq } from "drizzle-orm";
import { authed } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { getState } from "@/lib/state";

export const GET = authed(async (_req, { user }) => {
  const { finds, profile, settings, materials, user: u } = await getState(user);
  const events = await db
    .select({ type: schema.events.type, at: schema.events.at })
    .from(schema.events)
    .where(eq(schema.events.userId, user.id))
    .orderBy(asc(schema.events.at));
  const data = { exportedAt: new Date().toISOString(), user: u, settings, profile, materials, finds, events };
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="lookout-export.json"',
      "cache-control": "no-store",
    },
  });
});
