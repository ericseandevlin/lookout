import { authed } from "@/lib/api";
import { eventsFor } from "@/lib/eventStore";
import { getState } from "@/lib/state";

export const GET = authed(async (_req, { user }) => {
  const { finds, profile, settings, materials, user: u } = await getState(user);
  const events = await eventsFor(user.id);
  const data = { exportedAt: new Date().toISOString(), user: u, settings, profile, materials, finds, events };
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="lookout-export.json"',
      "cache-control": "no-store",
    },
  });
});
