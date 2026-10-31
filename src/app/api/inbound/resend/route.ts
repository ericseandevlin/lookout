import { json } from "@/lib/api";
import { storeReceived, verifyWebhook } from "@/lib/inbound";

export const dynamic = "force-dynamic";

/** Resend's email.received webhook (#178). Signed with RESEND_WEBHOOK_SECRET; the body is fetched from the Resend API. */
export async function POST(req: Request) {
  const body = await req.text();
  const ok = verifyWebhook(process.env.RESEND_WEBHOOK_SECRET ?? "", { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, body);
  if (!ok) return json({ error: "Bad signature" }, { status: 401 });
  const event = JSON.parse(body) as { type?: string; data?: { email_id?: string } };
  if (event.type !== "email.received" || !event.data?.email_id) return json({ ignored: true });
  try {
    return json({ stored: await storeReceived(event.data.email_id) });
  } catch (e) {
    // A 5xx makes Resend retry, which is what we want when its API or our database hiccups.
    console.error("[inbound]", e);
    return json({ error: "Could not store" }, { status: 502 });
  }
}
