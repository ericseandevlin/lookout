import { authed } from "@/lib/api";
import { eventsFor } from "@/lib/eventStore";
import { listSearches } from "@/lib/searches";
import { getFinds, getState } from "@/lib/state";

export const GET = authed(async (_req, { user }) => {
  const {
    finds,
    profile,
    settings,
    materials,
    user: u,
    searchId,
  } = await getState(user);
  // The board is one search; the export is all of them, so a second search's finds and answers aren't left out (#468).
  const searches = await Promise.all(
    (await listSearches(user.id)).map(async (s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      active: s.id === searchId,
      profile: {
        answers: s.answers,
        savedAt: s.savedAt?.toISOString() ?? null,
      },
      finds: await getFinds(user.id, s.id),
    })),
  );
  const events = await eventsFor(user.id);
  const data = {
    exportedAt: new Date().toISOString(),
    user: u,
    settings,
    profile,
    materials,
    finds,
    searches,
    events,
  };
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="lookout-export.json"',
      "cache-control": "no-store",
    },
  });
});
