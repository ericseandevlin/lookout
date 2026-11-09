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
// env.appUrl reads APP_URL; set it before the route loads (spreading env would trip its required DATABASE_URL getter).
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test", "x-forwarded-for": "10.0.0.1" }) }));
const createSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ createSession: (id: string) => createSession(id) }));

const { POST } = await import("./route");

const TOKEN = "t".repeat(40);
const post = (extra: Record<string, unknown> = {}) => POST(new Request("https://lookout.test/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN, ...extra }) }), {});
const addToken = (purpose: "login" | "email_change") =>
  db.insert(schema.loginTokens).values({ tokenHash: hashToken(TOKEN), email: "new@example.com", expiresAt: new Date(Date.now() + 3600_000), purpose });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  createSession.mockClear();
  await db.delete(schema.loginTokens);
  await db.delete(schema.rateLimits);
  await db.delete(schema.users);
});

describe("POST /api/auth/verify", () => {
  it("signs in with a login token", async () => {
    await addToken("login");
    const res = await post();
    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalledOnce();
  });

  it("records the Terms and Privacy agreement when it comes with the sign-in tap (#525)", async () => {
    await addToken("login");
    const res = await post({ agree: true });
    expect(res.status).toBe(200);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "new@example.com"));
    expect(u.termsVersion).toBeTruthy();
    expect(u.privacyVersion).toBeTruthy();
    expect(u.acceptedAt).toBeInstanceOf(Date);
  });

  it("leaves the agreement alone on a plain sign-in", async () => {
    await addToken("login");
    await post();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "new@example.com"));
    expect(u.acceptedAt).toBeNull();
  });

  it("refuses an email-change token, so it can't open a new account without an invite (#208)", async () => {
    await addToken("email_change");
    const res = await post();
    expect(res.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
    expect(await db.select().from(schema.users).where(eq(schema.users.email, "new@example.com"))).toHaveLength(0);
    // The token stays unused for confirm-email.
    const [row] = await db.select().from(schema.loginTokens);
    expect(row.usedAt).toBeNull();
  });
});
