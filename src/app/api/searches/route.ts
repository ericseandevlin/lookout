import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { track } from "@/lib/eventStore";
import { rateLimit } from "@/lib/ratelimit";
import { createSearch, listSearches } from "@/lib/searches";
import type { SearchInfo } from "@/lib/types";

/** The account's searches, oldest first (#8). */
export const GET = authed(async (_req, { user }) => {
  const rows = await listSearches(user.id);
  return json({ searches: rows.map(({ id, name, kind }): SearchInfo => ({ id, name, kind })) });
});

const Input = z.object({
  kind: z.string().trim().min(1).max(20),
  name: z.string().trim().max(80).optional(),
});

/** Create a search (kind from the kind configs) and make it the active one. */
export const POST = authed(async (req, { user }) => {
  const p = await body(req, Input);
  if (!await rateLimit(`new-search:${user.id}`, 10, 24 * 3600_000)) throw new HttpError(429, "That's enough new searches for today.");
  const search = await createSearch(user.id, p.kind, p.name);
  await track(user.id, "search_created", search.id, { kind: search.kind });
  return json({ search: { id: search.id, name: search.name, kind: search.kind } satisfies SearchInfo }, { status: 201 });
});