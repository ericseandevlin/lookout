import { authed, HttpError } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { attachment, exportable } from "@/lib/application/exportDoc";
import { draftToPdf } from "@/lib/application/pdf";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/** The resume or cover letter as a PDF, laid out like the review screen (#106): the approved version, else the latest. */
export const GET = authed<Ctx>(async (_req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { id, itemId } = await params;
  const d = await exportable(user, id, itemId);
  const buf = await draftToPdf(d.content, { title: d.name, header: d.letterHeader, template: d.template, accent: d.accent });
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": "application/pdf", "content-disposition": attachment(d.name, "pdf"), "cache-control": "no-store" },
  });
});
