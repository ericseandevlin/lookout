import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { emailShell, escapeHtml, sendMail } from "@/lib/email";
import { unsubscribeParts } from "@/lib/bulkMail";
import { env } from "@/lib/env";
import { goLink } from "./digestLinks";

const money = (n: number) => "$" + n.toLocaleString("en-US");

/** Email the finds added in the last day, if the user has the summary turned on. Links go through /go so clicks count (#34). */
export async function sendDigest(userId: string, runId?: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.userId, userId));
  if (!u || !s?.digest) return;
  const rows = await db
    .select()
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(and(eq(schema.userOpportunities.userId, userId), gte(schema.userOpportunities.addedAt, new Date(Date.now() - 24 * 3600_000))))
    .orderBy(desc(schema.userOpportunities.score));
  if (!rows.length) return;
  const items = rows.slice(0, 15).map(({ opportunities: o, user_opportunities: uo }) => {
    const comp = o.compMax ? `${money(o.compMin ?? o.compMax)} – ${money(o.compMax)}` : "No comp posted";
    return { o, uo, comp };
  });
  const n = rows.length;
  // Unsubscribe link, postal address and one-click headers, as for any bulk mail (#28).
  const { footer, headers } = unsubscribeParts("digest", u.email, "You get this because the finds email is on in your Lookout settings.");
  const [dg] = await db.insert(schema.digests).values({ userId, runId: runId ?? null, finds: n }).returning({ id: schema.digests.id });
  const link = (target: string) => goLink(env.appUrl, dg.id, target);
  const html = emailShell(
    `${n} new ${n === 1 ? "find" : "finds"} this week`,
    `<table width="100%" cellpadding="0" cellspacing="0">${items
      .map(
        ({ o, uo, comp }) => `<tr><td style="padding:12px 0;border-top:1px solid #EEEAE4">
<div style="font-size:14px;font-weight:700;color:#99220F">MATCH ${uo.score}/5</div>
<div style="font-size:15px;font-weight:600;margin-top:2px"><a href="${link(o.id)}" style="color:#1D1A0F">${escapeHtml(o.title)}</a></div>
<div style="font-size:14px;color:#6B6358">${escapeHtml(o.company)} · ${escapeHtml(o.location)}</div>
<div style="font-size:14px;color:${o.compMax ? "#99220F" : "#6B6358"};margin-top:2px">${comp}</div></td></tr>`,
      )
      .join("")}</table>
<a href="${link("board")}" style="display:inline-block;margin-top:20px;background:#99220F;color:#fff;text-decoration:none;font-weight:600;font-size:14.5px;padding:13px 24px;border-radius:12px">Open your board</a>${footer.html}`,
  );
  const text = items.map(({ o, uo, comp }) => `${uo.score}/5  ${o.title}, ${o.company} (${o.location}) ${comp}\n${link(o.id)}`).join("\n\n");
  try {
    await sendMail({
      to: u.email,
      subject: `Lookout: ${n} new ${n === 1 ? "find" : "finds"}`,
      text: `${text}\n\nOpen your board: ${link("board")}\n\n--\n${footer.text}`,
      html,
      headers,
    });
  } catch (e) {
    // Not sent, so it doesn't count as sent.
    await db.delete(schema.digests).where(eq(schema.digests.id, dg.id));
    throw e;
  }
}
