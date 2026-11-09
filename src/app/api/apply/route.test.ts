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
// Drafting and submitting are not under test: record which applications were started.
const kick = vi.fn();
vi.mock("@/lib/application/run", () => ({ kick, resumeFor: async () => {} }));

const queue = await import("./route");
const one = await import("./[id]/route");

const send = (method: string, url: string, data?: unknown) =>
  new Request(`https://lookout.test${url}`, { method, headers: { "content-type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
const post = (findId: string) => queue.POST(send("POST", "/api/apply", { findId }), {});
const cancel = (id: string) => one.DELETE(send("DELETE", `/api/apply/${id}`), { params: Promise.resolve({ id }) });
const detail = (id: string) => one.GET(send("GET", `/api/apply/${id}`), { params: Promise.resolve({ id }) });

let other: typeof schema.users.$inferSelect;
let findId = "";
let notMine = "";
const stageOf = async (opportunityId: string) =>
  (await db.select({ stage: schema.userOpportunities.stage }).from(schema.userOpportunities).where(eq(schema.userOpportunities.opportunityId, opportunityId)))[0]?.stage;
const apps = () => db.select().from(schema.applications);

async function addFind(userId: string, n: number) {
  const [search] = await db.insert(schema.searches).values({ userId, name: "Job search" }).returning();
  const [opp] = await db.insert(schema.opportunities).values({ company: `Venue ${n}`, title: "Director of Events", fingerprint: `fp-${n}` }).returning();
  await db.insert(schema.userOpportunities).values({ userId, searchId: search.id, opportunityId: opp.id, score: 5 });
  return opp.id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  beta = true;
  kick.mockClear();
  await db.delete(schema.users);
  await db.delete(schema.opportunities);
  [current, other] = await db.insert(schema.users).values([{ email: "maya@example.com" }, { email: "other@example.com" }]).returning();
  findId = await addFind(current.id, 1);
  notMine = await addFind(other.id, 2);
});

describe("POST /api/apply (#458)", () => {
  it("queues a find from your board, starts it, and moves its card to Auto-applying", async () => {
    const res = await post(findId);
    expect(res.status).toBe(200);
    const { id, status } = await res.json();
    expect(status).toBe("queued");
    expect(kick).toHaveBeenCalledWith(id);
    expect(await apps()).toEqual([expect.objectContaining({ id, userId: current!.id, opportunityId: findId, queuedBy: "user" })]);
    expect(await stageOf(findId)).toBe("Auto-applying");
  });

  it("refuses a find that is only on someone else's board", async () => {
    const res = await post(notMine);
    expect(res.status).toBe(404);
    expect(await apps()).toEqual([]);
    expect(kick).not.toHaveBeenCalled();
    expect(await stageOf(notMine)).toBe("Not applied");
  });

  it("doesn't start one again that's already further along", async () => {
    await db.insert(schema.applications).values({ userId: current!.id, opportunityId: findId, status: "needs_review" });
    const res = await post(findId);
    expect((await res.json()).status).toBe("needs_review");
    expect(kick).not.toHaveBeenCalled();
  });

  it("refuses a find id that isn't a uuid", async () => {
    expect((await post("123")).status).toBe(400);
  });

  it("is hidden without the auto-apply beta", async () => {
    beta = false;
    expect((await post(findId)).status).toBe(404);
    expect((await queue.GET(send("GET", "/api/apply"), {})).status).toBe(404);
    expect(await apps()).toEqual([]);
  });
});

describe("DELETE /api/apply/[id] (#458)", () => {
  it("cancels your application with its items and puts the card back to Not applied", async () => {
    const { id } = await (await post(findId)).json();
    await db.insert(schema.applicationItems).values({ applicationId: id, kind: "resume", prompt: "Resume" });
    const res = await cancel(id);
    expect(res.status).toBe(200);
    expect(await apps()).toEqual([]);
    expect(await db.select().from(schema.applicationItems)).toEqual([]);
    expect(await stageOf(findId)).toBe("Not applied");
  });

  it("leaves a card alone that has moved past Auto-applying", async () => {
    const { id } = await (await post(findId)).json();
    await db.update(schema.userOpportunities).set({ stage: "Interview" }).where(eq(schema.userOpportunities.opportunityId, findId));
    expect((await cancel(id)).status).toBe(200);
    expect(await stageOf(findId)).toBe("Interview");
  });

  it("won't cancel one that's been sent or is being sent", async () => {
    for (const status of ["submitted", "submitting"] as const) {
      await db.delete(schema.applications);
      const [a] = await db.insert(schema.applications).values({ userId: current!.id, opportunityId: findId, status }).returning();
      expect((await cancel(a.id)).status).toBe(409);
      expect(await apps()).toHaveLength(1);
    }
  });

  it("answers 404 for someone else's application, an unknown one, or a bad id", async () => {
    const [theirs] = await db.insert(schema.applications).values({ userId: other.id, opportunityId: notMine }).returning();
    expect((await cancel(theirs.id)).status).toBe(404);
    expect(await apps()).toHaveLength(1);
    expect((await cancel("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await cancel("not-a-uuid")).status).toBe(404);
  });

  it("is hidden without the auto-apply beta", async () => {
    const { id } = await (await post(findId)).json();
    beta = false;
    expect((await cancel(id)).status).toBe(404);
    expect(await apps()).toHaveLength(1);
  });
});

describe("GET /api/apply/[id] (#573)", () => {
  it("returns your application with its items in order and each item's versions, newest first", async () => {
    const { id } = await (await post(findId)).json();
    const [letter, resume] = await db
      .insert(schema.applicationItems)
      .values([
        { applicationId: id, kind: "cover_letter", prompt: "Cover letter", position: 1 },
        { applicationId: id, kind: "resume", prompt: "Resume", position: 0, required: true },
      ])
      .returning();
    await db.insert(schema.itemVersions).values([
      { itemId: resume.id, version: 1, content: "First", author: "ai" },
      { itemId: resume.id, version: 2, content: "Second", author: "user" },
    ]);
    const res = await detail(id);
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ id, findId, status: "queued", company: "Venue 1", role: "Director of Events" });
    expect(d.items.map((i: { id: string }) => i.id)).toEqual([resume.id, letter.id]);
    expect(d.items[0]).toMatchObject({ kind: "resume", required: true });
    expect(d.items[0].versions.map((v: { content: string }) => v.content)).toEqual(["Second", "First"]);
    expect(d.items[1].versions).toEqual([]);
  });

  it("answers 404 for someone else's application, an unknown one, or a bad id", async () => {
    const [theirs] = await db.insert(schema.applications).values({ userId: other.id, opportunityId: notMine }).returning();
    expect((await detail(theirs.id)).status).toBe(404);
    expect((await detail("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await detail("not-a-uuid")).status).toBe(404);
  });

  it("needs a session and the auto-apply beta", async () => {
    const { id } = await (await post(findId)).json();
    beta = false;
    expect((await detail(id)).status).toBe(404);
    beta = true;
    current = null;
    expect((await detail(id)).status).toBe(401);
  });
});
