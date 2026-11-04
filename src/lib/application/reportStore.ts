import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ApplicationReport, ApplicationStatus } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Change an application's report from its current saved state (#200). Model calls take up to a
 * minute; writing back a copy read before the call wiped keyword picks, Recruiter Analysis or fill
 * results saved meanwhile. This re-reads the row under a lock, applies the change and writes it,
 * so concurrent changes all survive. Pass `tx` to join a transaction already open.
 */
export async function patchReport(appId: string, change: (r: ApplicationReport) => ApplicationReport, also: { status?: ApplicationStatus; updatedAt?: Date } = {}, tx?: Tx) {
  const run = async (t: Tx) => {
    const [cur] = await t.select({ report: schema.applications.report }).from(schema.applications).where(eq(schema.applications.id, appId)).for("update");
    if (!cur) return null;
    const report = change(cur.report ?? {});
    await t.update(schema.applications).set({ report, ...also }).where(eq(schema.applications.id, appId));
    return report;
  };
  return tx ? run(tx) : db.transaction(run);
}

/** Add model spend to the application's running total. */
export const addUsd = (usd: number) => (r: ApplicationReport): ApplicationReport => ({ ...r, usd: (r.usd ?? 0) + usd });
