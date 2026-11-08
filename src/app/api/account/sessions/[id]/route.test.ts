import { PGlite } from "@electric-sql/pglite";
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
type User = typeof schema.users.$inferSelect;
let me: User | null = null;
let current: string | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {}, currentSessionHash: async () => current }));

const { DELETE } = await import("./route");

const del = (id: string) => DELETE(new Request(`https://lookout.test/api/account/sessions/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
const user = async (email: string) => (await db.insert(schema.users).values({ email }).returning())[0];
const session = async (u: User, idHash: string) => db.insert(schema.sessions).values({ idHash, userId: u.id, expiresAt: new Date(Date.now() + 864e5) });
const left = async () => (await db.select().from(schema.sessions)).map((s) => s.idHash).sort();
// Session hashes are 64 hex characters; the client sees the first 16 as the device id.
const hash = (c: string) => c.repeat(64);

let alice: User, bob: User;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  alice = await user("alice@example.com");
  bob = await user("bob@example.com");
  await session(alice, hash("a"));
  await session(alice, hash("b"));
  await session(bob, hash("c"));
  me = alice;
  current = hash("a");
});

describe("DELETE /api/account/sessions/[id] (#411)", () => {
  it("needs a session", async () => {
    me = null;
    expect((await del("b".repeat(16))).status).toBe(401);
    expect(await left()).toHaveLength(3);
  });

  it("signs out one of your other devices", async () => {
    const res = await del("b".repeat(16));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, signedOutHere: false });
    expect(await left()).toEqual([hash("a"), hash("c")]);
  });

  it("says so when you sign out this device", async () => {
    expect(await (await del("a".repeat(16))).json()).toEqual({ ok: true, signedOutHere: true });
    expect(await left()).toEqual([hash("b"), hash("c")]);
  });

  it("cannot sign out someone else's device", async () => {
    const res = await del("c".repeat(16));
    expect(res.status).toBe(200);
    expect(await left()).toEqual([hash("a"), hash("b"), hash("c")]);
  });

  it("signs out every other device and keeps this one", async () => {
    expect((await del("others")).status).toBe(200);
    expect(await left()).toEqual([hash("a"), hash("c")]);
  });

  it("refuses others with no current session", async () => {
    current = null;
    expect((await del("others")).status).toBe(400);
    expect(await left()).toHaveLength(3);
  });

  it("is 404 for anything but 16 hex characters, so LIKE wildcards cannot match every session", async () => {
    for (const id of ["%", "_".repeat(16), "a".repeat(15), "a".repeat(17), "A".repeat(16), "g".repeat(16)]) {
      expect((await del(id)).status).toBe(404);
    }
    expect(await left()).toHaveLength(3);
  });
});
