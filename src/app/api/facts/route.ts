import { authed, HttpError, json } from "@/lib/api";
import { featureOn } from "@/lib/features";
import { listFacts } from "@/lib/interview/facts";
import { importSetupFacts } from "@/lib/interview/session";

/** What Lookout knows (#1449): every fact, with its source and privacy. Behind FEATURE_INTERVIEW. */
export const GET = authed(async (_req, { user }) => {
  if (!featureOn("INTERVIEW")) throw new HttpError(404, "Not found");
  await importSetupFacts(user.id);
  const facts = await listFacts(user.id);
  return json({
    facts: facts.map((f) => ({
      id: f.id,
      text: f.text,
      kind: f.kind,
      source: f.source,
      quote: f.quote,
      turnId: f.turnId,
      shareable: f.shareable,
      lockReason: f.lockReason,
      createdAt: f.createdAt.toISOString(),
    })),
  });
});
