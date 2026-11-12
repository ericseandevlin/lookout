import { authed, HttpError } from "@/lib/api";
import { canUseAutoApply, getAutoApplySettings } from "@/lib/apply";
import { draftToDocx } from "@/lib/application/docx";
import { getMaster } from "@/lib/application/master";

/** The master resume as a Word file (#780): the version on the page, in the person's template and color. */
export const GET = authed(async (_req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { master } = await getMaster(user.id);
  if (!master?.md.trim()) throw new HttpError(404, "Build your master resume first.");
  const name = `${user.name || "Master"} - Resume`.replace(/[\\/:*?"<>|]/g, "-").trim();
  const s = await getAutoApplySettings(user.id);
  const buf = await draftToDocx(master.md, name, { template: s.template, accent: s.accent });
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "")}.docx"`,
      "cache-control": "no-store",
    },
  });
});
