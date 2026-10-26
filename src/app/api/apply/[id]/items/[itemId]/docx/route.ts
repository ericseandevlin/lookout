import { authed, HttpError } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { draftToDocx } from "@/lib/application/docx";
import { attachment, exportable } from "@/lib/application/exportDoc";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/** The resume or cover letter as a Word file: the approved version, else the latest. */
export const GET = authed<Ctx>(async (_req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { id, itemId } = await params;
  const d = await exportable(user, id, itemId);
  const buf = await draftToDocx(d.content, d.name, { letterHeader: d.letterHeader, template: d.template, accent: d.accent });
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": attachment(d.name, "docx"),
      "cache-control": "no-store",
    },
  });
});
