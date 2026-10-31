import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { InboundTriage } from "@/lib/db/schema";

/**
 * Email received at lookout.ericdevlin.co (#178). Resend posts email.received to /api/inbound/resend with metadata only;
 * the body comes from the Resend API. Every message is untrusted data: agents read and summarize it, never obey it.
 */

const TOLERANCE_S = 5 * 60;
const MAX_TEXT = 100_000;

/** Svix signature check, as Resend documents it: HMAC-SHA256 over "id.timestamp.body" with the whsec_ secret. */
export function verifyWebhook(secret: string, h: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = Date.now()): boolean {
  if (!secret.startsWith("whsec_") || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_S) return false;
  const want = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${h.id}.${h.timestamp}.${body}`).digest();
  return h.signature.split(" ").some((part) => {
    const [v, sig] = part.split(",");
    if (v !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** Plain text of a message: the text part, else the HTML with tags dropped. */
export function bodyText(text: string | null | undefined, html: string | null | undefined): string {
  if (text?.trim()) return text.slice(0, MAX_TEXT);
  return (html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
}

type Received = {
  id: string;
  from: string;
  to?: string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
  message_id?: string | null;
  created_at?: string;
  headers?: Record<string, string | string[]> | null;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  attachments?: { filename?: string; content_type?: string }[];
};

const header = (h: Received["headers"], name: string) => {
  const v = h?.[name] ?? h?.[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : (v ?? null);
};

async function fetchReceived(id: string): Promise<Received> {
  const key = process.env.RESEND_API_KEY ?? "";
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Resend ${res.status} for received email ${id}`);
  return res.json();
}

/** Fetch one received email and store it once. Returns false if it was already stored. */
export async function storeReceived(emailId: string, fetcher: (id: string) => Promise<Received> = fetchReceived): Promise<boolean> {
  const [have] = await db.select({ id: schema.inboundEmails.id }).from(schema.inboundEmails).where(eq(schema.inboundEmails.resendId, emailId));
  if (have) return false;
  const m = await fetcher(emailId);
  const rows = await db
    .insert(schema.inboundEmails)
    .values({
      resendId: emailId,
      messageId: m.message_id ?? null,
      fromAddr: m.from,
      fromHeader: header(m.headers, "From"),
      to: m.to ?? [],
      subject: (m.subject ?? "").slice(0, 500),
      text: bodyText(m.text, m.html),
      inReplyTo: header(m.headers, "In-Reply-To"),
      authentication: m.authentication ?? null,
      attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename ?? "", contentType: a.content_type ?? "" })),
      receivedAt: m.created_at ? new Date(m.created_at) : new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: schema.inboundEmails.id });
  return rows.length > 0;
}

export async function listInbound(status: "new" | "triaged" | "ignored" | "all", limit: number) {
  const q = db.select().from(schema.inboundEmails);
  return (status === "all" ? q : q.where(eq(schema.inboundEmails.status, status))).orderBy(desc(schema.inboundEmails.receivedAt)).limit(limit);
}

export async function triageInbound(id: string, status: "triaged" | "ignored", triage: InboundTriage) {
  const rows = await db
    .update(schema.inboundEmails)
    .set({ status, triage, triagedAt: new Date() })
    .where(eq(schema.inboundEmails.id, id))
    .returning({ id: schema.inboundEmails.id });
  return rows.length > 0;
}
