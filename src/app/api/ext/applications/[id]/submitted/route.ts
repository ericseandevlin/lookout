import { z } from "zod";
import { body, json } from "@/lib/api";
import { markSubmitted } from "@/lib/application/review";
import { extensionRoute } from "@/lib/extension";

// The page URL is kept with the record of what was sent. Only web pages; anything else (javascript:, data:) is
// dropped rather than refused, so the submission is still recorded (#469).
const PageUrl = z
  .string()
  .max(2000)
  .transform((u) =>
    /^https?:\/\//i.test(u) && URL.canParse(u) ? u : undefined,
  );

type Ctx = { params: Promise<{ id: string }> };

/** The extension saw the thank-you page (or the user clicked "I submitted it"): record it and move the find to Applied. */
export const POST = extensionRoute<Ctx>(async (req, { user, params }) => {
  const p = await body(
    req,
    z.object({ url: PageUrl.optional(), text: z.string().max(300).optional() }),
  );
  return json({
    status: await markSubmitted(user.id, (await params).id, {
      how: "extension",
      ...p,
    }),
  });
});
