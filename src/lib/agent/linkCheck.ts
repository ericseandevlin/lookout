import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchPage, FetchError, pageToText } from "@/lib/ai/fetchPage";
import { classifyPage, type LinkState } from "./linkState";

/** Stored on opportunities.attributes so every person's board shares one check per posting. */
type LinkCheck = { checkedAt: string; state: LinkState; reason: string; goneSince?: string };

const CONFIRM_MS = 20 * 3600_000; // gone on two checks at least this far apart before anything closes
// Only these close. Finds they're pursuing (Applied, Interview, Offer) or already passed on (Nope) are never checked.
const CLOSABLE = ["Not applied", "Auto-applying", "Ghosted", "Not selected"];

// Some careers sites answer inconsistently (one server in maintenance, the next with the real page), so an
// inconclusive answer is retried a few times before it counts as unknown.
async function check(url: string): Promise<{ state: LinkState; reason: string }> {
  let last = await checkOnce(url);
  for (let i = 1; i < 3 && last.state === "unknown"; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    last = await checkOnce(url);
  }
  return last;
}

async function checkOnce(url: string): Promise<{ state: LinkState; reason: string }> {
  try {
    const { url: finalUrl, html } = await fetchPage(url);
    return classifyPage(200, pageToText(html, 4000), finalUrl);
  } catch (e) {
    const status = e instanceof FetchError ? Number(e.message.match(/answered (\d{3})/)?.[1]) : NaN;
    return Number.isFinite(status) ? classifyPage(status, "") : { state: "unknown", reason: "couldn't reach it" };
  }
}

/**
 * Re-checks the person's open finds and closes postings that are confirmed gone: stage Closed, archived, and a note
 * with the date it was first seen gone. Finds they're actively pursuing or passed on are never touched. Returns how many closed.
 */
export async function closeGonePostings(userId: string, now = new Date()): Promise<number> {
  const rows = await db
    .select({ uo: schema.userOpportunities, o: schema.opportunities })
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(and(eq(schema.userOpportunities.userId, userId), eq(schema.userOpportunities.archived, false)));
  const open = rows.filter((r) => r.o.sourceUrl && CLOSABLE.includes(r.uo.stage));

  let closed = 0;
  const queue = [...open];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const prev = (r.o.attributes?.linkCheck ?? null) as LinkCheck | null;
      // Checked on every search run.
      const { state, reason } = await check(r.o.sourceUrl!);
      // goneSince starts at the first gone result and survives "unknown" (a maintenance page proves nothing); an open result clears it.
      const goneSince = state === "gone" ? (prev?.goneSince ?? now.toISOString()) : state === "open" ? undefined : prev?.goneSince;
      const lc: LinkCheck = { checkedAt: now.toISOString(), state, reason, ...(goneSince && { goneSince }) };
      await db
        .update(schema.opportunities)
        .set({ attributes: { ...(r.o.attributes ?? {}), linkCheck: lc } })
        .where(eq(schema.opportunities.id, r.o.id));
      if (lc.state === "gone" && lc.goneSince && now.getTime() - Date.parse(lc.goneSince) >= CONFIRM_MS) {
        const day = lc.goneSince.slice(0, 10);
        const line = `Closed: the posting was gone (${lc.reason}) as of ${day}. Lookout archived it.`;
        // The stage may have moved since the read (they applied mid-run); count only a find this actually closed (#614).
        const done = await db
          .update(schema.userOpportunities)
          .set({ stage: "Closed", archived: true, notes: r.uo.notes ? `${r.uo.notes.trimEnd()}\n\n${line}` : line })
          .where(and(eq(schema.userOpportunities.userId, userId), eq(schema.userOpportunities.opportunityId, r.o.id), inArray(schema.userOpportunities.stage, CLOSABLE)))
          .returning({ stage: schema.userOpportunities.stage });
        closed += done.length;
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return closed;
}
