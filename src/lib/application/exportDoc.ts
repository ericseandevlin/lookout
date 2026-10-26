import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { HttpError } from "@/lib/api";
import { getAutoApplySettings } from "@/lib/apply";
import { db, schema } from "@/lib/db";
import { ownApplication } from "./review";
import { letterHeaderFrom } from "./resumeLayout";

/** The approved version of an item, else its latest. */
async function outgoing(it: typeof schema.applicationItems.$inferSelect) {
  const [v] = it.approvedVersionId
    ? await db.select().from(schema.itemVersions).where(eq(schema.itemVersions.id, it.approvedVersionId))
    : await db.select().from(schema.itemVersions).where(eq(schema.itemVersions.itemId, it.id)).orderBy(desc(schema.itemVersions.version)).limit(1);
  return v;
}

/** Everything a .docx or PDF of the resume or cover letter needs: the text that goes out, its file name, the letter header and the design. */
export async function exportable(user: { id: string; name: string }, id: string, itemId: string) {
  const a = await ownApplication(user.id, id);
  const [it] = await db.select().from(schema.applicationItems).where(and(eq(schema.applicationItems.id, itemId), eq(schema.applicationItems.applicationId, a.id)));
  if (!it || (it.kind !== "resume" && it.kind !== "cover_letter")) throw new HttpError(404, "Not found");
  const v = await outgoing(it);
  if (!v?.content.trim()) throw new HttpError(404, "Nothing drafted yet");
  const [o] = await db.select({ company: schema.opportunities.company }).from(schema.opportunities).where(eq(schema.opportunities.id, a.opportunityId));
  const name = `${user.name || "Resume"} - ${o?.company ?? ""} ${it.kind === "resume" ? "Resume" : "Cover Letter"}`.replace(/[\\/:*?"<>|]/g, "-").trim();
  let letterHeader;
  if (it.kind === "cover_letter") {
    const [r] = await db.select().from(schema.applicationItems).where(and(eq(schema.applicationItems.applicationId, a.id), eq(schema.applicationItems.kind, "resume")));
    letterHeader = letterHeaderFrom(r ? (await outgoing(r))?.content : undefined, user.name);
  }
  const s = await getAutoApplySettings(user.id);
  return { content: v.content, name, letterHeader, template: s.template ?? ("modern" as const), accent: s.accent };
}

export const attachment = (name: string, ext: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "").replace(/"/g, "")}.${ext}"`;
