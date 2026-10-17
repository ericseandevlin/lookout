import { readFile } from "node:fs/promises";
import path from "node:path";
import { authed, HttpError } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { ownApplication } from "@/lib/application/review";
import { shotDir } from "@/lib/application/submit";

type Ctx = { params: Promise<{ id: string }> };

/** The browser worker's screenshots: the filled form, and the page after Submit. */
export const GET = authed<Ctx>(async (req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const a = await ownApplication(user.id, (await params).id);
  const which = new URL(req.url).searchParams.get("which") === "after-submit" ? "after-submit" : "filled";
  const buf = await readFile(path.join(shotDir(a.id), `${which}.png`)).catch(() => null);
  if (!buf) throw new HttpError(404, "No screenshot yet");
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
});
