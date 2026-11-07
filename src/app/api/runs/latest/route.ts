import { authed, HttpError, json } from "@/lib/api";
import { getLatestRun } from "@/lib/state";
import { getActiveSearch } from "@/lib/searches";

/** The run the board's progress panel follows: the active search's newest run (#8). */
export const GET = authed(async (_req, { user }) => {
  const search = await getActiveSearch(user.id);
  if (!search) throw new HttpError(409, "Create a search first.");
  return json({ run: await getLatestRun(search.id) });
});