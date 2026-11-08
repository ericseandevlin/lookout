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
  process.env.ADMIN_EMAILS = "";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
type User = typeof schema.users.$inferSelect;
let me: User | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));

const { PATCH } = await import("./route");

const patch = (id: string, data: unknown) =>
  PATCH(new Request(`https://lookout.test/api/admin/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {
    params: Promise.resolve({ id }),
  });
const user = async (email: string, isAdmin = false) => (await db.insert(schema.users).values({ email, isAdmin }).returning())[0];
const get = async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0];
const sessionsOf = async (id: string) => db.select().from(schema.sessions).where(eq(schema.sessions.userId, id));

let admin: User, bob: User;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  admin = await user("admin@example.com", true);
  bob = await user("bob@example.com");
  await db.insert(schema.sessions).values({ idHash: "b".repeat(64), userId: bob.id, expiresAt: new Date(Date.now() + 864e5) });
  me = admin;
});

describe("PATCH /api/admin/users/[id] (#411)", () => {
  it("needs a session, then an admin", async () => {
    me = null;
    expect((await patch(bob.id, { isAdmin: true })).status).toBe(401);
    me = bob;
    expect((await patch(bob.id, { isAdmin: true })).status).toBe(403);
    expect((await get(bob.id)).isAdmin).toBe(false);
  });

  it("will not change your own access", async () => {
    expect((await patch(admin.id, { isAdmin: false })).status).toBe(400);
    expect((await get(admin.id)).isAdmin).toBe(true);
  });

  it("is 404 for a bad or unknown id", async () => {
    expect((await patch("nope", { disabled: true })).status).toBe(404);
    expect((await patch(crypto.randomUUID(), { disabled: true })).status).toBe(404);
  });

  it("is 400 for invalid input", async () => {
    expect((await patch(bob.id, { disabled: "yes" })).status).toBe(400);
  });

  it("disables a user and signs them out everywhere", async () => {
    expect((await patch(bob.id, { disabled: true })).status).toBe(200);
    expect((await get(bob.id)).disabled).toBe(true);
    expect(await sessionsOf(bob.id)).toEqual([]);
  });

  it("re-enables a user without touching sessions", async () => {
    await db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, bob.id));
    expect((await patch(bob.id, { disabled: false })).status).toBe(200);
    expect((await get(bob.id)).disabled).toBe(false);
    expect(await sessionsOf(bob.id)).toHaveLength(1);
  });

  it("makes someone an admin and keeps their sessions", async () => {
    expect((await patch(bob.id, { isAdmin: true })).status).toBe(200);
    expect((await get(bob.id)).isAdmin).toBe(true);
    expect(await sessionsOf(bob.id)).toHaveLength(1);
  });
});
