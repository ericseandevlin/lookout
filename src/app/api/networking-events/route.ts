import { featureOn } from "@/lib/features";
import { z } from "zod";
import { authed, body, json, HttpError } from "@/lib/api";
import { eventSearchRunning, getEventPrefs, getInterestSuggestions, listEvents, saveEventPrefs } from "@/lib/agent/networking";
import { EVENT_FREQS, EVENT_REACH, MILES, type NetworkingEvent } from "@/lib/networking";

/** Networking events for the Events page (#7, #265): pinned and archived flags included. Past ones are cleared on read. */
export const GET = authed(async (_req, { user }) => {
  if (!featureOn("EVENTS")) throw new HttpError(404, "Not found");
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
    pinned: r.pinned,
    archived: r.archived,
    fit: r.fit,
    miles: r.miles,
  }));
  return json({ events, prefs: await getEventPrefs(user.id), suggestions: await getInterestSuggestions(user.id), searching: await eventSearchRunning(user.id) });
});

const Prefs = z.object({
  interests: z.string().trim().max(300),
  reach: z.enum(EVENT_REACH as ["nearby", "online", "both"]),
  miles: z.number().int().refine((n) => (MILES as readonly number[]).includes(n)),
  freq: z.enum(EVENT_FREQS as ["weekly", "monthly"]).default("weekly"),
});

/** What to look for. Empty interests turn event search off. */
export const PUT = authed(async (req, { user }) => {
  if (!featureOn("EVENTS")) throw new HttpError(404, "Not found");
  await saveEventPrefs(user.id, await body(req, Prefs));
  return json({ prefs: await getEventPrefs(user.id) });
});
