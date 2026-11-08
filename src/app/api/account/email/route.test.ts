import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
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
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
type User = typeof schema.users.$inferSelect;
let me: User | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));
const sent: Mail[] = [];
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendMail: async (m: Mail) => void sent.push(m) }));

const { POST } = await import("./route");

const post = (email: string) => POST(new Request("https://lookout.test/api/account/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }), {});
const user = async (email: string) => (await db.insert(schema.users).values({ email }).returning())[0];
const tokens = () => db.select().from(schema.loginTokens);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  sent.length = 0;
  process.env.SMTP_URL = "smtp://mail.test";
  await db.delete(schema.loginTokens);
  await db.delete(schema.rateLimits);
  await db.delete(schema.users);
  me = await user("maya@example.com");
});

describe("POST /api/account/email", () => {
  it("mails a one-hour confirmation link to the new address and changes nothing yet", async () => {
    const before = Date.now();
    const res = await post(" Maya.New@Example.com ");
    expect(res.status).toBe(200);
    expect(sent.map((m) => m.to)).toEqual(["maya.new@example.com"]);
    const token = sent[0].text.match(/auth\/confirm-email\?token=([\w-]+)/)?.[1];
    expect(token).toBeTruthy();
    const [row] = await tokens();
    expect(row).toMatchObject({ email: "maya.new@example.com", purpose: "email_change", userId: me!.id, tokenHash: hashToken(token!), usedAt: null });
    const ttl = row.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(59 * 60_000);
    expect(ttl).toBeLessThanOrEqual(60 * 60_000 + 5_000);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, me!.id));
    expect(u.email).toBe("maya@example.com");
  });

  it("is 503 when mail isn't set up, since the new address couldn't be confirmed", async () => {
    process.env.SMTP_URL = "";
    const res = await post("maya.new@example.com");
    expect(res.status).toBe(503);
    expect(await tokens()).toHaveLength(0);
  });

  it("refuses the current address, in any case", async () => {
    expect((await post("MAYA@example.com")).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("refuses an address that belongs to another account", async () => {
    await user("jeff@example.com");
    expect((await post("Jeff@example.com")).status).toBe(409);
    expect(await tokens()).toHaveLength(0);
  });

  it("allows 5 requests an hour per person", async () => {
    for (let i = 0; i < 5; i++) expect((await post(`new${i}@example.com`)).status).toBe(200);
    expect((await post("new5@example.com")).status).toBe(429);
    expect(sent).toHaveLength(5);
  });

  it("needs a session", async () => {
    me = null;
    expect((await post("maya.new@example.com")).status).toBe(401);
    expect(sent).toHaveLength(0);
  });
});
