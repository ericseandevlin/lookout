import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { emailShell, escapeHtml, sendMail } from "@/lib/email";
import { unsubscribeParts } from "@/lib/bulkMail";
import { env } from "@/lib/env";
import { goLink } from "./digestLinks";
import { dueLabel, pickDueSoon } from "./digestDue";
import { compLabel } from "./digestComp";

/** Email the finds added in the last day, plus pinned finds due in the next week (#304), if the user has the summary turned on. Links go through /go so clicks count (#34).
 * Due-soon finds alone send it too, but at most once a day, since this runs after every scheduled search. */
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
  const pinned = await db
    .select()
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(and(eq(schema.userOpportunities.userId, userId), eq(schema.userOpportunities.pinned, true), eq(schema.userOpportunities.archived, false)));
  const newIds = new Set(rows.map((r) => r.opportunities.id));
  // A find pinned on two searches is one deadline.
  const pinnedFinds = [...new Map(pinned.map((r) => [r.opportunities.id, r.opportunities])).values()];
  const due = pickDueSoon(pinnedFinds.filter((o) => !newIds.has(o.id)));
  if (!rows.length && !due.length) return;
  if (!rows.length) {
    const [recent] = await db
      .select({ id: schema.digests.id })
      .from(schema.digests)
      .where(and(eq(schema.digests.userId, userId), gte(schema.digests.sentAt, new Date(Date.now() - 20 * 3600_000))))
      .limit(1);
    if (recent) return;
  }
  const items = rows.slice(0, 15).map(({ opportunities: o, user_opportunities: uo }) => {
    const posted = compLabel(o.compMin, o.compMax, o.currency);
    return { o, uo, comp: posted ?? "No comp posted", posted: !!posted };
  });
  const n = rows.length;
  // Unsubscribe link, postal address and one-click headers, as for any bulk mail (#28).
  const { footer, headers } = unsubscribeParts("digest", u.email, "You get this because the finds email is on in your Lookout settings.");
  const [dg] = await db.insert(schema.digests).values({ userId, runId: runId ?? null, finds: n }).returning({ id: schema.digests.id });
  const link = (target: string) => goLink(env.appUrl, dg.id, target);
  const dueHtml = due.length
    ? `<div style="font-size:13px;font-weight:700;letter-spacing:.04em;color:#6B6358;margin:${n ? "28px" : "0"} 0 4px">DUE SOON</div>
<table width="100%" cellpadding="0" cellspacing="0">${due
        .map(
          ({ row: o, days }) => `<tr><td style="padding:12px 0;border-top:1px solid #EEEAE4">
<div style="font-size:14px;font-weight:700;color:#99220F">${dueLabel(days).toUpperCase()}</div>
<div style="font-size:15px;font-weight:600;margin-top:2px"><a href="${link(o.id)}" style="color:#1D1A0F">${escapeHtml(o.title)}</a></div>
<div style="font-size:14px;color:#6B6358">${escapeHtml(o.company)}</div></td></tr>`,
        )
        .join("")}</table>`
    : "";
  const dueText = due.map(({ row: o, days }) => `${dueLabel(days)}: ${o.title}, ${o.company}\n${link(o.id)}`).join("\n\n");
  const headline = n ? `${n} new ${n === 1 ? "find" : "finds"} today` : `${due.length} pinned ${due.length === 1 ? "find" : "finds"} due soon`;
  const html = emailShell(
    headline,
    `${n ? `<table width="100%" cellpadding="0" cellspacing="0">${items
      .map(
        ({ o, uo, comp, posted }) => `<tr><td style="padding:12px 0;border-top:1px solid #EEEAE4">
<div style="font-size:14px;font-weight:700;color:#99220F">MATCH ${uo.score}/5</div>
<div style="font-size:15px;font-weight:600;margin-top:2px"><a href="${link(o.id)}" style="color:#1D1A0F">${escapeHtml(o.title)}</a></div>
<div style="font-size:14px;color:#6B6358">${escapeHtml(o.company)} · ${escapeHtml(o.location)}</div>
<div style="font-size:14px;color:${posted ? "#99220F" : "#6B6358"};margin-top:2px">${comp}</div></td></tr>`,
      )
      .join("")}</table>` : ""}${dueHtml}
<a href="${link("board")}" style="display:inline-block;margin-top:20px;background:#99220F;color:#fff;text-decoration:none;font-weight:600;font-size:14.5px;padding:13px 24px;border-radius:12px">Open your board</a>${footer.html}`,
  );
  const newText = items.map(({ o, uo, comp }) => `${uo.score}/5  ${o.title}, ${o.company} (${o.location}) ${comp}\n${link(o.id)}`).join("\n\n");
  const text = [newText, dueText && `Due soon\n\n${dueText}`].filter(Boolean).join("\n\n");
  try {
    await sendMail({
      to: u.email,
      subject: n ? `Lookout: ${n} new ${n === 1 ? "find" : "finds"}${due.length ? `, ${due.length} due soon` : ""}` : `Lookout: ${headline}`,
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
