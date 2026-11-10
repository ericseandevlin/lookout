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
const resumeFor = vi.fn(async () => {});
vi.mock("@/lib/application/run", () => ({ kick, resumeFor }));

const queue = await import("./route");
const one = await import("./[id]/route");

const send = (method: string, url: string, data?: unknown) =>
  new Request(`https://lookout.test${url}`, { method, headers: { "content-type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
const settings = () => queue.GET(send("GET", "/api/apply"), {});
const patch = (data: unknown) => queue.PATCH(send("PATCH", "/api/apply", data), {});
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
  resumeFor.mockClear();
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

describe("GET /api/apply (#594)", () => {
  it("returns the default settings and an empty queue for a new account", async () => {
    const res = await settings();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settings: { enabled: false, threshold: 5, dailyCap: 3 }, applications: [] });
    expect(resumeFor).toHaveBeenCalledWith(current!.id);
  });

  it("lists only your applications, with the find they came from", async () => {
    const { id } = await (await post(findId)).json();
    await db.insert(schema.applications).values({ userId: other.id, opportunityId: notMine, queuedBy: "user" });
    const { applications } = await (await settings()).json();
    expect(applications).toEqual([
      expect.objectContaining({ id, findId, company: "Venue 1", role: "Director of Events", score: 5, status: "queued", queuedBy: "user", items: 0, error: null }),
    ]);
  });

  it("needs a session and the auto-apply beta", async () => {
    beta = false;
    expect((await settings()).status).toBe(404);
    expect(resumeFor).not.toHaveBeenCalled();
    beta = true;
    current = null;
    expect((await settings()).status).toBe(401);
  });
});

describe("PATCH /api/apply (#594)", () => {
  const events = () => db.select({ type: schema.events.type }).from(schema.events);

  it("saves a partial change over the current settings and returns them", async () => {
    const res = await patch({ enabled: true, dailyCap: 10 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settings: { enabled: true, threshold: 5, dailyCap: 10 } });
    await patch({ threshold: 4, template: "modern", accent: "1A2B3c" });
    expect((await (await settings()).json()).settings).toEqual({ enabled: true, threshold: 4, dailyCap: 10, template: "modern", accent: "1A2B3c" });
    expect(resumeFor).toHaveBeenCalledWith(current!.id);
  });

  it("records turning auto-apply on and off, and not a change that leaves it as it was", async () => {
    await patch({ enabled: true });
    await patch({ dailyCap: 5 });
    await patch({ enabled: false });
    expect((await events()).map((e) => e.type)).toEqual(["auto_apply_on", "auto_apply_off"]);
  });

  it("refuses values outside what the settings page offers, and saves nothing", async () => {
    for (const bad of [{ threshold: 3 }, { dailyCap: 0 }, { dailyCap: 21 }, { dailyCap: 2.5 }, { template: "fancy" }, { accent: "#1A2B3C" }, { accent: "red" }, { enabled: "yes" }]) {
      expect((await patch(bad)).status).toBe(400);
    }
    expect((await (await settings()).json()).settings).toEqual({ enabled: false, threshold: 5, dailyCap: 3 });
  });

  it("doesn't touch another account's settings", async () => {
    await patch({ enabled: true });
    current = other;
    expect((await (await settings()).json()).settings.enabled).toBe(false);
  });

  it("needs a session and the auto-apply beta", async () => {
    beta = false;
    expect((await patch({ enabled: true })).status).toBe(404);
    beta = true;
    expect((await (await settings()).json()).settings.enabled).toBe(false);
    current = null;
    expect((await patch({ enabled: true })).status).toBe(401);
  });
});
