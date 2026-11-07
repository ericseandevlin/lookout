import { errorResponse, HttpError, json } from "@/lib/api";
import { optOut, readToken } from "@/lib/bulkMail";

/**
 * Unsubscribe (#28). Mail apps POST here with no Origin for one-click unsubscribe (RFC 8058), and
 * the /unsubscribe page posts here too. The signed token is the only thing that authorizes it, so
 * this skips the same-origin check. GET does nothing: link scanners must not unsubscribe anyone.
 */
export async function POST(req: Request) {
  try {
    const t = readToken(new URL(req.url).searchParams.get("t") ?? "");
    if (!t) throw new HttpError(400, "That unsubscribe link isn't valid.");
    await optOut(t.list, t.email);
    return json({ ok: true, list: t.list });
  } catch (e) {
    return errorResponse(e, req);
  }
}
