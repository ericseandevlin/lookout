import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { hashToken } from "@/lib/auth/crypto";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test", "x-forwarded-for": "10.0.0.1" }) }));

const { POST } = await import("./route");

const TOKEN = "t".repeat(40);
const post = (token = TOKEN) => POST(new Request("https://lookout.test/api/auth/confirm-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }), {});
const HOUR = 3600_000;
type Token = Partial<typeof schema.loginTokens.$inferInsert>;
const addToken = (over: Token = {}) =>
  db.insert(schema.loginTokens).values({ tokenHash: hashToken(TOKEN), email: "maya.new@example.com", purpose: "email_change", userId: maya.id, expiresAt: new Date(Date.now() + HOUR), ...over });
const emailOf = async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0].email;

let maya: typeof schema.users.$inferSelect;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.loginTokens);
  await db.delete(schema.rateLimits);
  await db.delete(schema.users);
  [maya] = await db.insert(schema.users).values({ email: "maya@example.com" }).returning();
});

describe("POST /api/auth/confirm-email", () => {
  it("switches the email and burns the token, so the link works once", async () => {
    await addToken();
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: "maya.new@example.com" });
    expect(await emailOf(maya.id)).toBe("maya.new@example.com");
    const [row] = await db.select().from(schema.loginTokens);
    expect(row.usedAt).toBeInstanceOf(Date);
    expect((await post()).status).toBe(400);
  });

  it("stops unused sign-in links for the old address, and leaves other people's alone", async () => {
    await addToken();
    const exp = new Date(Date.now() + HOUR);
    await db.insert(schema.loginTokens).values([
      { tokenHash: hashToken("old-link".repeat(4)), email: "maya@example.com", expiresAt: exp },
      { tokenHash: hashToken("jeff-link".repeat(4)), email: "jeff@example.com", expiresAt: exp },
    ]);
    await post();
    const left = (await db.select().from(schema.loginTokens)).map((t) => t.email).sort();
    expect(left).toEqual(["jeff@example.com", "maya.new@example.com"]);
  });

  it("won't accept a sign-in token", async () => {
    await addToken({ purpose: "login", userId: null });
    expect((await post()).status).toBe(400);
    expect(await emailOf(maya.id)).toBe("maya@example.com");
  });

  it("won't accept an expired or used token", async () => {
    await addToken({ expiresAt: new Date(Date.now() - 1000) });
    expect((await post()).status).toBe(400);
    await db.delete(schema.loginTokens);
    await addToken({ usedAt: new Date() });
    expect((await post()).status).toBe(400);
    expect(await emailOf(maya.id)).toBe("maya@example.com");
  });

  it("is 409 when someone else took the address after the link went out", async () => {
    await addToken();
    await db.insert(schema.users).values({ email: "Maya.New@example.com" });
    expect((await post()).status).toBe(409);
    expect(await emailOf(maya.id)).toBe("maya@example.com");
  });

  it("allows 30 attempts an hour per IP", async () => {
    for (let i = 0; i < 30; i++) expect((await post()).status).toBe(400);
    await addToken();
    expect((await post()).status).toBe(429);
    expect(await emailOf(maya.id)).toBe("maya@example.com");
  });
});
