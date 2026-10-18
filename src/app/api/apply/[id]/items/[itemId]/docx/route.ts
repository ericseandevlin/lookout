import { and, desc, eq } from "drizzle-orm";
import { authed, HttpError } from "@/lib/api";
import { canUseAutoApply, getAutoApplySettings } from "@/lib/apply";
import { draftToDocx } from "@/lib/application/docx";
import { ownApplication } from "@/lib/application/review";
import { letterHeaderFrom } from "@/lib/application/resumeLayout";
import { db, schema } from "@/lib/db";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/** The resume or cover letter as a Word file: the approved version, else the latest. */
export const GET = authed<Ctx>(async (_req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { id, itemId } = await params;
  const a = await ownApplication(user.id, id);
  const [it] = await db.select().from(schema.applicationItems).where(and(eq(schema.applicationItems.id, itemId), eq(schema.applicationItems.applicationId, a.id)));
  if (!it || (it.kind !== "resume" && it.kind !== "cover_letter")) throw new HttpError(404, "Not found");
  const [v] = it.approvedVersionId
    ? await db.select().from(schema.itemVersions).where(eq(schema.itemVersions.id, it.approvedVersionId))
    : await db.select().from(schema.itemVersions).where(eq(schema.itemVersions.itemId, it.id)).orderBy(desc(schema.itemVersions.version)).limit(1);
  if (!v?.content.trim()) throw new HttpError(404, "Nothing drafted yet");
  const [o] = await db.select({ company: schema.opportunities.company }).from(schema.opportunities).where(eq(schema.opportunities.id, a.opportunityId));
  const name = `${user.name || "Resume"} - ${o?.company ?? ""} ${it.kind === "resume" ? "Resume" : "Cover Letter"}`.replace(/[\\/:*?"<>|]/g, "-").trim();
  let letterHeader;
  if (it.kind === "cover_letter") {
    const [r] = await db.select().from(schema.applicationItems).where(and(eq(schema.applicationItems.applicationId, a.id), eq(schema.applicationItems.kind, "resume")));
    const [rv] = r
      ? r.approvedVersionId
        ? await db.select().from(schema.itemVersions).where(eq(schema.itemVersions.id, r.approvedVersionId))
        : await db.select().from(schema.itemVersions).where(eq(schema.itemVersions.itemId, r.id)).orderBy(desc(schema.itemVersions.version)).limit(1)
      : [];
    letterHeader = letterHeaderFrom(rv?.content, user.name);
  }
  const s = await getAutoApplySettings(user.id);
  const buf = await draftToDocx(v.content, name, { letterHeader, template: s.template, accent: s.accent });
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "")}.docx"`,
      "cache-control": "no-store",
    },
  });
});
