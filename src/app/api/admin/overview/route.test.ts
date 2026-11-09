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
  process.env.ADMIN_EMAILS = "boss@example.com";
});
type User = typeof schema.users.$inferSelect;
let me: User | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));

const { GET } = await import("./route");

const get = () => GET(new Request("https://lookout.test/api/admin/overview"), {});
const user = async (email: string, isAdmin = false) => (await db.insert(schema.users).values({ email, isAdmin }).returning())[0];
const run = (userId: string, costUsd: string, daysAgo: number) =>
  db.insert(schema.runs).values({ userId, trigger: "scheduled", status: "done", costUsd, startedAt: new Date(Date.now() - daysAgo * 864e5) });

let admin: User, bob: User;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.runs);
  await db.delete(schema.invites);
  await db.delete(schema.users);
  admin = await user("admin@example.com", true);
  bob = await user("bob@example.com");
  me = admin;
});

describe("GET /api/admin/overview (#537)", () => {
  it("needs a session, then an admin", async () => {
    me = null;
    expect((await get()).status).toBe(401);
    me = bob;
    expect((await get()).status).toBe(403);
  });

  it("adds up run costs for the last day, week and month", async () => {
    await run(bob.id, "0.5000", 0.1);
    await run(bob.id, "1.0000", 3);
    await run(admin.id, "2.0000", 20);
    await run(bob.id, "8.0000", 40);
    const body = await (await get()).json();
    expect(body.totals).toEqual({ users: 2, usdDay: 0.5, usdWeek: 1.5, usdMonth: 3.5 });
    const b = body.users.find((u: { email: string }) => u.email === "bob@example.com");
    expect(b.runs30).toBe(2);
    expect(b.usd30).toBe(1.5);
    expect(body.runs).toHaveLength(4);
    expect(body.runs[0]).toMatchObject({ email: "bob@example.com", costUsd: 0.5 });
  });

  it("marks an invite accepted once that email has an account, and leaves out revoked ones", async () => {
    await db.insert(schema.invites).values([
      { email: "bob@example.com" },
      { email: "new@example.com" },
      { email: "gone@example.com", revokedAt: new Date() },
    ]);
    const { invites } = await (await get()).json();
    expect(invites.map((i: { email: string; accepted: boolean }) => [i.email, i.accepted]).sort()).toEqual([
      ["bob@example.com", true],
      ["new@example.com", false],
    ]);
  });

  it("counts someone in ADMIN_EMAILS as an admin without the flag", async () => {
    await user("boss@example.com");
    const { users } = await (await get()).json();
    const flags = Object.fromEntries(users.map((u: { email: string; isAdmin: boolean }) => [u.email, u.isAdmin]));
    expect(flags).toEqual({ "admin@example.com": true, "bob@example.com": false, "boss@example.com": true });
  });
});
