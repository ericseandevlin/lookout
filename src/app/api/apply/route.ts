import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply, getAutoApplySettings, listApplications, queueApplication, saveAutoApplySettings } from "@/lib/apply";

/** Auto-apply beta: settings and the application queue. */
export const GET = authed(async (_req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  return json({ settings: await getAutoApplySettings(user.id), applications: await listApplications(user.id) });
});

const Settings = z.object({
  enabled: z.boolean().optional(),
  threshold: z.union([z.literal(4), z.literal(5)]).optional(),
  dailyCap: z.number().int().min(1).max(20).optional(),
});

export const PATCH = authed(async (req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  return json({ settings: await saveAutoApplySettings(user.id, await body(req, Settings)) });
});

/** Queue one find from the board. */
export const POST = authed(async (req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { findId } = await body(req, z.object({ findId: z.string().uuid() }));
  const row = await queueApplication(user.id, findId, "user");
  if (!row) throw new HttpError(404, "That role isn't on your board");
  return json({ id: row.id, status: row.status });
});
