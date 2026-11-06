import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { getEventPrefs, listEvents, saveEventPrefs } from "@/lib/agent/networking";
import { EVENT_REACH, MILES, type NetworkingEvent } from "@/lib/networking";

/** Upcoming networking events for the Events page (#7). Past ones are cleared on read. */
export const GET = authed(async (_req, { user }) => {
  const rows = await listEvents(user.id);
  const events: NetworkingEvent[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    host: r.host,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    time: r.time,
    place: r.place,
    online: r.online,
    cost: r.cost,
    why: r.why,
    url: r.url,
  }));
  return json({ events, prefs: await getEventPrefs(user.id) });
});

const Prefs = z.object({
  interests: z.string().trim().max(300),
  reach: z.enum(EVENT_REACH as ["nearby", "online", "both"]),
  miles: z.number().int().refine((n) => (MILES as readonly number[]).includes(n)),
});

/** What to look for. Empty interests turn event search off. */
export const PUT = authed(async (req, { user }) => {
  await saveEventPrefs(user.id, await body(req, Prefs));
  return json({ prefs: await getEventPrefs(user.id) });
});
