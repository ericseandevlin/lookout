import { authed } from "@/lib/api";
import { getState } from "@/lib/state";

export const GET = authed(async (_req, { user }) => {
  const { finds, profile, settings, materials, user: u } = await getState(user);
  const data = { exportedAt: new Date().toISOString(), user: u, settings, profile, materials, finds };
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="lookout-export.json"',
      "cache-control": "no-store",
    },
  });
});
