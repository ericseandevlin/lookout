import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

const { addUsd, patchReport } = await import("./reportStore");

let appId = "";
beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  const [u] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [o] = await db.insert(schema.opportunities).values({ company: "Acme", title: "Lead", fingerprint: "acme-lead" } as typeof schema.opportunities.$inferInsert).returning();
  const [a] = await db.insert(schema.applications).values({ userId: u.id, opportunityId: o.id, report: { usd: 1 } } as typeof schema.applications.$inferInsert).returning();
  appId = a.id;
});
afterAll(async () => {
  await pg.close();
});

const report = async () => (await db.select({ r: schema.applications.report }).from(schema.applications).where(eq(schema.applications.id, appId)))[0].r;

describe("patchReport (#200)", () => {
  it("keeps what was saved after a stale copy was read", async () => {
    // A revise reads the report, then a keyword pick lands while its model call runs.
    const stale = await report();
    await db.update(schema.applications).set({ report: { ...stale, keywordChoices: { include: ["Figma"], exclude: [] } } }).where(eq(schema.applications.id, appId));
    // The revise finishes and adds its spend through patchReport, not by writing back `stale`.
    await patchReport(appId, addUsd(0.5));
    expect(await report()).toEqual({ usd: 1.5, keywordChoices: { include: ["Figma"], exclude: [] } });
  });

  it("changes made at the same time all survive", async () => {
    await Promise.all([patchReport(appId, addUsd(0.25)), patchReport(appId, (r) => ({ ...r, recruiter: {} })), patchReport(appId, addUsd(0.25))]);
    const r = await report();
    expect(r.usd).toBe(2);
    expect(r.recruiter).toEqual({});
    expect(r.keywordChoices?.include).toEqual(["Figma"]);
  });

  it("sets status alongside, inside a caller's transaction", async () => {
    // PGlite's transaction type differs from the app driver's; the calls are the same.
    await db.transaction((tx) => patchReport(appId, (r) => ({ ...r, error: "x" }), { status: "needs_review" }, tx as unknown as Parameters<typeof patchReport>[3]));
    const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, appId));
    expect(a.status).toBe("needs_review");
    expect(a.report.error).toBe("x");
  });

  it("returns null for an application that doesn't exist", async () => {
    expect(await patchReport("00000000-0000-0000-0000-000000000000", (r) => r)).toBeNull();
  });
});
