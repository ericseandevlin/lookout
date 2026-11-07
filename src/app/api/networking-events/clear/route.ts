import { authed, json } from "@/lib/api";
import { clearEvents } from "@/lib/agent/networking";

/** "Clear" on Events (#265): archives every event that isn't pinned. */
export const POST = authed(async (_req, { user }) => json({ archived: await clearEvents(user.id) }));
