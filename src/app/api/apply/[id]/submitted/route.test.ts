import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let current: typeof schema.users.$inferSelect | null = null;
let beta = true;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => current, refreshSession: async () => {} }));
vi.mock("@/lib/apply", async (orig) => ({ ...(await orig<typeof import("@/lib/apply")>()), canUseAutoApply: () => beta }));

const { POST } = await import("./route");

type App = typeof schema.applications.$inferSelect;
const submitted = (id: string) =>
  POST(new Request(`https://lookout.test/api/apply/${id}/submitted`, { method: "POST" }), { params: Promise.resolve({ id }) });

let other: typeof schema.users.$inferSelect;
let findId = "";
let notMine = "";
const stageOf = async (opportunityId: string) =>
  (await db.select({ stage: schema.userOpportunities.stage }).from(schema.userOpportunities).where(eq(schema.userOpportunities.opportunityId, opportunityId)))[0]?.stage;
const appOf = async (id: string) => (await db.select().from(schema.applications).where(eq(schema.applications.id, id)))[0];

async function addFind(userId: string, n: number) {
  const [search] = await db.insert(schema.searches).values({ userId, name: "Job search" }).returning();
  const [opp] = await db.insert(schema.opportunities).values({ company: `Venue ${n}`, title: "Director of Events", fingerprint: `fp-${n}` }).returning();
  await db.insert(schema.userOpportunities).values({ userId, searchId: search.id, opportunityId: opp.id, score: 5, stage: "Auto-applying" });
  return opp.id;
}
const application = async (userId: string, opportunityId: string, status: App["status"]) =>
  (await db.insert(schema.applications).values({ userId, opportunityId, status, report: { applyUrl: "https://jobs.example.com/apply" } }).returning())[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  beta = true;
  await db.delete(schema.users);
  await db.delete(schema.opportunities);
  [current, other] = await db.insert(schema.users).values([{ email: "maya@example.com" }, { email: "other@example.com" }]).returning();
  findId = await addFind(current.id, 1);
  notMine = await addFind(other.id, 2);
});

describe("POST /api/apply/[id]/submitted (#573)", () => {
  it("records what was approved as sent by hand and moves the find to Applied", async () => {
    const a = await application(current!.id, findId, "manual");
    const [resume, outreach] = await db
      .insert(schema.applicationItems)
      .values([
        { applicationId: a.id, kind: "resume", prompt: "Resume", position: 0 },
        { applicationId: a.id, kind: "outreach", prompt: "Note to the recruiter", position: 1 },
      ])
      .returning();
    const [v] = await db.insert(schema.itemVersions).values({ itemId: resume.id, version: 2, content: "# Maya", author: "user" }).returning();
    const [o] = await db.insert(schema.itemVersions).values({ itemId: outreach.id, version: 1, content: "Hi", author: "ai" }).returning();
    await db.update(schema.applicationItems).set({ approvedVersionId: v.id }).where(eq(schema.applicationItems.id, resume.id));
    await db.update(schema.applicationItems).set({ approvedVersionId: o.id }).where(eq(schema.applicationItems.id, outreach.id));

    const res = await submitted(a.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "submitted" });
    const after = await appOf(a.id);
    expect(after.status).toBe("submitted");
    expect(after.submittedAt).toBeInstanceOf(Date);
    expect(after.confirmation).toMatchObject({
      how: "manual",
      applyUrl: "https://jobs.example.com/apply",
      sent: [{ prompt: "Resume", kind: "resume", version: 2, content: "# Maya" }],
    });
    expect(await stageOf(findId)).toBe("Applied");
  });

  it("works from approved too, and records it only once", async () => {
    const a = await application(current!.id, findId, "approved");
    expect((await (await submitted(a.id)).json()).status).toBe("submitted");
    const first = (await appOf(a.id)).submittedAt;
    expect((await (await submitted(a.id)).json()).status).toBe("submitted");
    expect((await appOf(a.id)).submittedAt).toEqual(first);
  });

  it("is 409 until every required item is approved, changing nothing", async () => {
    for (const status of ["queued", "drafting", "needs_review", "failed"] as const) {
      await db.delete(schema.applications);
      const a = await application(current!.id, findId, status);
      expect((await submitted(a.id)).status).toBe(409);
      expect((await appOf(a.id)).status).toBe(status);
    }
    expect(await stageOf(findId)).toBe("Auto-applying");
  });

  it("answers 404 for someone else's application, an unknown one, or a bad id", async () => {
    const theirs = await application(other.id, notMine, "manual");
    expect((await submitted(theirs.id)).status).toBe(404);
    expect((await appOf(theirs.id)).status).toBe("manual");
    expect(await stageOf(notMine)).toBe("Auto-applying");
    expect((await submitted("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await submitted("not-a-uuid")).status).toBe(404);
  });

  it("needs a session and the auto-apply beta", async () => {
    const a = await application(current!.id, findId, "manual");
    beta = false;
    expect((await submitted(a.id)).status).toBe(404);
    beta = true;
    current = null;
    expect((await submitted(a.id)).status).toBe(401);
    expect((await appOf(a.id)).status).toBe("manual");
  });
});
