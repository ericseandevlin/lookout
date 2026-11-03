import "server-only";
import { db, schema } from "@/lib/db";
import type { EventType } from "@/lib/db/schema";

/** Record a product event (#35). Never throws: a lost event must not fail the request it rides on. */
export async function track(userId: string, type: EventType) {
  await db
    .insert(schema.events)
    .values({ userId, type })
    .catch((e) => console.error("track", type, e));
}
