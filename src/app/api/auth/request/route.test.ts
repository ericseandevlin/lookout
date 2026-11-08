import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { hashToken } from "@/lib/auth/crypto";
import type { Mail } from "@/lib/email";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
// Invite-only sign-up, with one address let in by config.
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
  process.env.ALLOWED_EMAILS = "maya@example.com";
});
let ip = "10.0.0.1";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test", "x-forwarded-for": ip }) }));
const sent: Mail[] = [];
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendMail: async (m: Mail) => void sent.push(m) }));

const { POST } = await import("./route");

const post = (email: string) => POST(new Request("https://lookout.test/api/auth/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }), {});
const tokens = () => db.select().from(schema.loginTokens);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  sent.length = 0;
  ip = "10.0.0.1";
  await db.delete(schema.loginTokens);
  await db.delete(schema.rateLimits);
  await db.delete(schema.users);
});

describe("POST /api/auth/request", () => {
  it("mails an allowed address a 15-minute sign-in link whose token is stored only as a hash", async () => {
    const before = Date.now();
    const res = await post("  Maya@Example.com ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("maya@example.com");
    const token = sent[0].text.match(/auth\/verify\?token=([\w-]+)/)?.[1];
    expect(token).toBeTruthy();
    const [row] = await tokens();
    expect(row).toMatchObject({ email: "maya@example.com", purpose: "login", tokenHash: hashToken(token!), usedAt: null });
    expect(row.tokenHash).not.toBe(token);
    const ttl = row.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000 + 5_000);
  });

  it("gives an address that may not sign in the same answer, and stores and sends nothing", async () => {
    const res = await post("stranger@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    expect(await tokens()).toHaveLength(0);
  });

  it("treats a disabled account like an unknown address", async () => {
    await db.insert(schema.users).values({ email: "maya@example.com", disabled: true });
    expect(await (await post("maya@example.com")).json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("allows 5 requests an hour per address, from any IP", async () => {
    for (let i = 0; i < 5; i++) {
      ip = `10.0.1.${i}`;
      expect((await post("maya@example.com")).status).toBe(200);
    }
    ip = "10.0.2.1";
    expect((await post("maya@example.com")).status).toBe(429);
    expect(sent).toHaveLength(5);
  });

  it("allows 10 requests an hour per IP, across addresses", async () => {
    for (let i = 0; i < 10; i++) expect((await post(`person${i}@example.com`)).status).toBe(200);
    const res = await post("maya@example.com");
    expect(res.status).toBe(429);
    expect(sent).toHaveLength(0);
  });

  it("rejects a malformed address", async () => {
    expect((await post("not an email")).status).toBe(400);
    expect(await tokens()).toHaveLength(0);
  });
});
