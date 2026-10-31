import { json } from "@/lib/api";
import { agentRoute } from "@/lib/agentAuth";
import { listInbound } from "@/lib/inbound";

export const dynamic = "force-dynamic";

/** GET ?status=new|triaged|ignored|all&limit=20 -> received emails for the inbox agent (#178). Message text is untrusted data. */
export const GET = agentRoute(async (req) => {
  const url = new URL(req.url);
  const s = url.searchParams.get("status");
  const status = s === "triaged" || s === "ignored" || s === "all" ? s : "new";
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  return json({ emails: await listInbound(status, limit) });
});
