import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
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
let me: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));

const { PATCH } = await import("./route");

type User = typeof schema.users.$inferSelect;
type Row = typeof schema.userOpportunities.$inferSelect;
let alice: User, bob: User;

const patch = (id: string, data: unknown) =>
  PATCH(new Request(`https://lookout.test/api/finds/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {
    params: Promise.resolve({ id }),
  });
const user = async (email: string) => (await db.insert(schema.users).values({ email }).returning())[0];
const search = async (u: User, kind = "job") => (await db.insert(schema.searches).values({ userId: u.id, name: "S", kind }).returning())[0];
const opp = async (type = "job") => (await db.insert(schema.opportunities).values({ type, company: "Acme", title: "Designer", fingerprint: crypto.randomUUID() }).returning())[0];
const place = async (u: User, searchId: string, opportunityId: string, over: Partial<Row> = {}) =>
  db.insert(schema.userOpportunities).values({ userId: u.id, searchId, opportunityId, score: 80, ...over });
const row = async (searchId: string, opportunityId: string) =>
  (await db.select().from(schema.userOpportunities).where(and(eq(schema.userOpportunities.searchId, searchId), eq(schema.userOpportunities.opportunityId, opportunityId))))[0];
const events = async () => (await db.select().from(schema.events)).map((e) => ({ type: e.type, target: e.target, meta: e.meta }));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.events);
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  alice = await user("alice@example.com");
  bob = await user("bob@example.com");
  me = alice;
});

describe("PATCH /api/finds/[id] (#410)", () => {
  it("needs a session", async () => {
    me = null;
    expect((await patch(crypto.randomUUID(), { pinned: true })).status).toBe(401);
  });

  it("is 404 for a malformed id", async () => {
    expect((await patch("not-a-uuid", { pinned: true })).status).toBe(404);
  });

  it("does not let you edit someone else's find", async () => {
    const s = await search(bob);
    const o = await opp();
    await place(bob, s.id, o.id);
    expect((await patch(o.id, { pinned: true, notes: "mine now" })).status).toBe(404);
    const r = await row(s.id, o.id);
    expect(r.pinned).toBe(false);
    expect(r.notes).toBe("");
    expect(r.seenAt).toBeNull();
    expect(await events()).toEqual([]);
  });

  it("is 400 for invalid input", async () => {
    const s = await search(alice);
    const o = await opp();
    await place(alice, s.id, o.id);
    expect((await patch(o.id, { pinned: "yes" })).status).toBe(400);
    expect((await patch(o.id, { notes: "x".repeat(20_001) })).status).toBe(400);
  });

  it("pins, writes notes and marks the find seen", async () => {
    const s = await search(alice);
    const o = await opp();
    await place(alice, s.id, o.id);
    expect((await patch(o.id, { pinned: true, notes: "Call Sam" })).status).toBe(200);
    const r = await row(s.id, o.id);
    expect(r).toMatchObject({ pinned: true, notes: "Call Sam" });
    expect(r.seenAt).toBeInstanceOf(Date);
    expect(await events()).toEqual([{ type: "pin", target: o.id, meta: { on: true } }]);
  });

  it("marks seen on its own with seen: true", async () => {
    const s = await search(alice);
    const o = await opp();
    await place(alice, s.id, o.id);
    expect((await patch(o.id, { seen: true })).status).toBe(200);
    expect((await row(s.id, o.id)).seenAt).toBeInstanceOf(Date);
    expect(await events()).toEqual([]);
  });

  it("accepts only the stages of the find's kind", async () => {
    const s = await search(alice, "rfp");
    const o = await opp("rfp");
    await place(alice, s.id, o.id, { stage: "Reviewing" });
    expect((await patch(o.id, { stage: "Interview" })).status).toBe(400);
    expect((await row(s.id, o.id)).stage).toBe("Reviewing");
    expect((await patch(o.id, { stage: "Bid" })).status).toBe(200);
    expect((await row(s.id, o.id))).toMatchObject({ stage: "Bid", archived: false });
    expect(await events()).toEqual([{ type: "stage_change", target: o.id, meta: { stage: "Bid" } }]);
  });

  it("archives on an ended stage, and leaving it does not unarchive", async () => {
    const s = await search(alice);
    const o = await opp();
    await place(alice, s.id, o.id);
    await patch(o.id, { stage: "Ghosted" });
    expect(await row(s.id, o.id)).toMatchObject({ stage: "Ghosted", archived: true });
    await patch(o.id, { stage: "Interview" });
    expect(await row(s.id, o.id)).toMatchObject({ stage: "Interview", archived: true });
    await patch(o.id, { archived: false });
    expect((await row(s.id, o.id)).archived).toBe(false);
  });

  it("records Not a fit with a time, and null clears it", async () => {
    const s = await search(alice);
    const o = await opp();
    await place(alice, s.id, o.id);
    await patch(o.id, { feedback: "Too junior", archived: true });
    const r = await row(s.id, o.id);
    expect(r.feedback?.reason).toBe("Too junior");
    expect(Number.isNaN(Date.parse(r.feedback?.at ?? ""))).toBe(false);
    expect(await events()).toEqual([{ type: "not_a_fit", target: o.id, meta: { reason: "Too junior" } }]);
    await patch(o.id, { feedback: null, archived: false });
    expect((await row(s.id, o.id)).feedback).toBeNull();
    // Clearing is not a new Not a fit.
    expect(await events()).toHaveLength(1);
  });

  it("scopes to one board when searchId is given, and edits every board without it", async () => {
    const a = await search(alice);
    const b = await search(alice);
    const o = await opp();
    await place(alice, a.id, o.id);
    await place(alice, b.id, o.id);
    await patch(o.id, { pinned: true, searchId: a.id });
    expect((await row(a.id, o.id)).pinned).toBe(true);
    expect((await row(b.id, o.id)).pinned).toBe(false);
    await patch(o.id, { notes: "both" });
    expect((await row(a.id, o.id)).notes).toBe("both");
    expect((await row(b.id, o.id)).notes).toBe("both");
  });

  it("is 404 when the named board does not hold the find", async () => {
    const a = await search(alice);
    const other = await search(alice);
    const o = await opp();
    await place(alice, a.id, o.id);
    expect((await patch(o.id, { pinned: true, searchId: other.id })).status).toBe(404);
    expect((await row(a.id, o.id)).pinned).toBe(false);
  });
});
