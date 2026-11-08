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
  process.env.APP_SECRET = "a".repeat(32);
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let me: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));

const { GET, PUT, DELETE } = await import("./route");

type User = typeof schema.users.$inferSelect;
let alice: User, bob: User;

const url = "https://lookout.test/api/profile/eeo";
const get = () => GET(new Request(url), {});
const put = (data: unknown) => PUT(new Request(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {});
const del = () => DELETE(new Request(url, { method: "DELETE" }), {});
const user = async (email: string, isAdmin = true) => {
  const [u] = await db.insert(schema.users).values({ email, isAdmin }).returning();
  await db.insert(schema.profiles).values({ userId: u.id });
  return u;
};
const stored = async (u: User) => (await db.select().from(schema.profiles).where(eq(schema.profiles.userId, u.id)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_AUTO_APPLY = "on";
  await db.delete(schema.users);
  alice = await user("alice@example.com");
  bob = await user("bob@example.com");
  me = alice;
});

describe("/api/profile/eeo gate (#463)", () => {
  it("needs a session", async () => {
    me = null;
    expect((await get()).status).toBe(401);
  });

  it("is 404 while auto-apply is off", async () => {
    process.env.FEATURE_AUTO_APPLY = "off";
    expect((await get()).status).toBe(404);
    expect((await put({ consent: true })).status).toBe(404);
    expect((await del()).status).toBe(404);
  });

  it("is 404 for someone outside the beta", async () => {
    me = await user("carol@example.com", false);
    expect((await get()).status).toBe(404);
    expect((await put({ answers: { veteran: "Not a veteran" } })).status).toBe(404);
    expect((await stored(me)).eeo).toBeNull();
  });
});

describe("GET, PUT /api/profile/eeo (#463)", () => {
  it("starts empty with consent off", async () => {
    expect(await (await get()).json()).toEqual({ consent: false, answers: {}, saved: 0 });
  });

  it("saves answers encrypted and reads them back", async () => {
    const res = await put({ consent: true, answers: { gender: "Woman", veteran: "Not a veteran" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ consent: true, answers: { gender: "Woman", veteran: "Not a veteran" }, saved: 0 });
    const row = await stored(alice);
    expect(row.eeoConsent).toBe(true);
    expect(row.eeo).toBeTruthy();
    expect(row.eeo).not.toContain("Woman");
    expect((await (await get()).json()).answers).toEqual({ gender: "Woman", veteran: "Not a veteran" });
  });

  it("saves one category at a time, as the page does", async () => {
    expect((await put({ answers: { gender: "Woman" } })).status).toBe(200);
    const res = await put({ answers: { race: "Asian" } });
    expect(res.status).toBe(200);
    expect((await res.json()).answers).toEqual({ gender: "Woman", race: "Asian" });
  });

  it("only shows answers to their owner", async () => {
    await put({ consent: true, answers: { gender: "Woman" } });
    me = bob;
    expect(await (await get()).json()).toEqual({ consent: false, answers: {}, saved: 0 });
  });

  it("refuses an answer that isn't on the list and keeps what was saved", async () => {
    await put({ answers: { gender: "Woman" } });
    expect((await put({ answers: { gender: "Robot" } })).status).toBe(400);
    expect((await put({ answers: { favoriteColor: "Blue" } })).status).toBe(400);
    expect((await (await get()).json()).answers).toEqual({ gender: "Woman" });
  });

  it("clears one category with an empty answer and keeps the rest", async () => {
    await put({ answers: { gender: "Woman", veteran: "Not a veteran" } });
    const res = await put({ answers: { gender: "" } });
    expect((await res.json()).answers).toEqual({ veteran: "Not a veteran" });
  });

  it("changes consent without touching the answers", async () => {
    await put({ consent: true, answers: { veteran: "Not a veteran" } });
    const res = await put({ consent: false });
    expect(await res.json()).toEqual({ consent: false, answers: { veteran: "Not a veteran" }, saved: 0 });
  });
});

describe("DELETE /api/profile/eeo (#463)", () => {
  it("forgets every answer and turns consent off", async () => {
    await put({ consent: true, answers: { gender: "Woman", veteran: "Not a veteran" } });
    const res = await del();
    expect(await res.json()).toEqual({ consent: false, answers: {}, saved: 0 });
    const row = await stored(alice);
    expect(row.eeo).toBeNull();
    expect(row.eeoConsent).toBe(false);
  });

  it("leaves other people's answers alone", async () => {
    me = bob;
    await put({ consent: true, answers: { veteran: "Not a veteran" } });
    me = alice;
    await del();
    me = bob;
    expect((await (await get()).json()).answers).toEqual({ veteran: "Not a veteran" });
  });
});
