import { featureOn } from "@/lib/features";
import { authed, HttpError, json } from "@/lib/api";
import { clearEvents } from "@/lib/agent/networking";

/** Archive every event that isn't pinned (#265). */
export const POST = authed(async (_req, { user }) => {
  if (!featureOn("EVENTS")) throw new HttpError(404, "Not found");
  return json({ archived: await clearEvents(user.id) });
});
