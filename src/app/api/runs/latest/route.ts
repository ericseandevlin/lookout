import { authed, json } from "@/lib/api";
import { getLatestRun } from "@/lib/state";

export const GET = authed(async (_req, { user }) => json({ run: await getLatestRun(user.id) }));
