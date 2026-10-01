import { authed, json } from "@/lib/api";
import { getState } from "@/lib/state";

export const GET = authed(async (_req, { user }) => json(await getState(user)));
