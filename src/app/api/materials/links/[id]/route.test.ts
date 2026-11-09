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
let me: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));
// Reading the page goes to the network; only check that a fresh read starts.
const readLink = vi.fn(async () => {});
vi.mock("@/lib/agent/links", () => ({ readLink }));

const { PATCH, DELETE } = await import("./route");

type User = typeof schema.users.$inferSelect;
let alice: User, bob: User;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, data: unknown) =>
  PATCH(new Request(`https://lookout.test/api/materials/links/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), ctx(id));
const del = (id: string) => DELETE(new Request(`https://lookout.test/api/materials/links/${id}`, { method: "DELETE" }), ctx(id));
const user = async (email: string) => (await db.insert(schema.users).values({ email }).returning())[0];
const material = async (u: User, over: Partial<typeof schema.materials.$inferInsert> = {}) =>
  (await db.insert(schema.materials).values({ userId: u.id, kind: "link", url: "https://alice.design", ...over }).returning())[0];
const get = async (id: string) => (await db.select().from(schema.materials).where(eq(schema.materials.id, id)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  readLink.mockClear();
  await db.delete(schema.users);
  alice = await user("alice@example.com");
  bob = await user("bob@example.com");
  me = alice;
});

describe("PATCH /api/materials/links/[id] (#461)", () => {
  it("needs a session", async () => {
    me = null;
    expect((await patch(crypto.randomUUID(), { kind: "Website" })).status).toBe(401);
  });

  it("is 404 for a malformed id", async () => {
    expect((await patch("not-a-uuid", { kind: "Website" })).status).toBe(404);
  });

  it("saves a new URL and starts a fresh read of it", async () => {
    const m = await material(alice);
    expect((await patch(m.id, { url: "https://alice.design/work" })).status).toBe(200);
    expect((await get(m.id)).url).toBe("https://alice.design/work");
    expect(readLink).toHaveBeenCalledWith(m.id, "https://alice.design/work");
  });

  it("sets the label and clears it back to auto-detect", async () => {
    const m = await material(alice);
    await patch(m.id, { kind: "Portfolio" });
    expect((await get(m.id)).linkKind).toBe("Portfolio");
    await patch(m.id, { kind: null });
    expect((await get(m.id)).linkKind).toBeNull();
    // A label change alone does not refetch the page.
    expect(readLink).not.toHaveBeenCalled();
  });

  it("refuses a label that isn't on the list and an unsafe URL", async () => {
    const m = await material(alice);
    expect((await patch(m.id, { kind: "MySpace" })).status).toBe(400);
    expect((await patch(m.id, { url: "javascript:alert(1)" })).status).toBe(400);
    expect((await get(m.id)).url).toBe("https://alice.design");
  });

  it("does not let you edit someone else's link", async () => {
    const m = await material(bob);
    expect((await patch(m.id, { url: "https://evil.example" })).status).toBe(404);
    expect((await get(m.id)).url).toBe("https://alice.design");
    expect(readLink).not.toHaveBeenCalled();
  });

  it("does not edit a material that is not a link", async () => {
    const m = await material(alice, { kind: "resume", url: null });
    expect((await patch(m.id, { url: "https://alice.design" })).status).toBe(404);
    expect((await get(m.id)).url).toBeNull();
  });

  it("answers a patch with no fields without a server error", async () => {
    const m = await material(alice);
    expect((await patch(m.id, {})).status).toBe(200);
    expect((await get(m.id)).url).toBe("https://alice.design");
  });

  it("is 404 for an empty patch to someone else's link", async () => {
    const m = await material(bob);
    expect((await patch(m.id, {})).status).toBe(404);
  });
});

describe("DELETE /api/materials/links/[id] (#461)", () => {
  it("needs a session", async () => {
    me = null;
    expect((await del(crypto.randomUUID())).status).toBe(401);
  });

  it("deletes your own link", async () => {
    const m = await material(alice);
    expect((await del(m.id)).status).toBe(200);
    expect(await get(m.id)).toBeUndefined();
  });

  it("leaves someone else's link and your other materials alone", async () => {
    const theirs = await material(bob);
    const resume = await material(alice, { kind: "resume", url: null });
    await del(theirs.id);
    await del(resume.id);
    expect(await get(theirs.id)).toBeDefined();
    expect(await get(resume.id)).toBeDefined();
  });
});
