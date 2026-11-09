import { and, eq, inArray } from "drizzle-orm";
import { json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { extensionRoute } from "@/lib/extension";
import { sameJob } from "@/lib/extension/match";

/** Which of your ready applications is the job open in this tab? `?url=` once per page and frame URL. */
export const GET = extensionRoute(async (req, { user }) => {
  const urls = new URL(req.url).searchParams.getAll("url").slice(0, 30);
  const rows = await db
    .select({
      id: schema.applications.id,
      status: schema.applications.status,
      report: schema.applications.report,
      company: schema.opportunities.company,
      title: schema.opportunities.title,
      sourceUrl: schema.opportunities.sourceUrl,
    })
    .from(schema.applications)
    .innerJoin(
      schema.opportunities,
      eq(schema.opportunities.id, schema.applications.opportunityId),
    )
    .where(
      and(
        eq(schema.applications.userId, user.id),
        inArray(schema.applications.status, [
          "approved",
          "manual",
          "submitted",
        ]),
      ),
    );
  const matches = rows
    .filter((r) => sameJob(urls, [r.report.applyUrl, r.sourceUrl]))
    .map(({ id, status, company, title }) => ({ id, status, company, title }));
  return json({ matches });
});
