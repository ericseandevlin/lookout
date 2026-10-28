import { z } from "zod";
import { body, json } from "@/lib/api";
import { markSubmitted } from "@/lib/application/review";
import { extensionRoute } from "@/lib/extension";

type Ctx = { params: Promise<{ id: string }> };

/** The extension saw the thank-you page (or the user clicked "I submitted it"): record it and move the find to Applied. */
export const POST = extensionRoute<Ctx>(async (req, { user, params }) => {
  const p = await body(req, z.object({ url: z.string().url().max(2000).optional(), text: z.string().max(300).optional() }));
  return json({ status: await markSubmitted(user.id, (await params).id, { how: "extension", ...p }) });
});
