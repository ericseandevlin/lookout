import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

const { createExtensionToken, extensionRoute, extensionStatus, revokeExtensionToken } = await import("./index");

const route = extensionRoute(async (_req, { user }) => Response.json({ email: user.email }));
const call = (token?: string) => route(new Request("https://x.test/api/ext/match", token ? { headers: { authorization: `Bearer ${token}` } } : {}), {});
let userId = "";

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_AUTO_APPLY = "on";
  await db.delete(schema.extensionTokens);
  await db.delete(schema.users);
  [{ id: userId }] = await db.insert(schema.users).values({ email: "eric@example.com", isAdmin: true }).returning({ id: schema.users.id });
});

describe("extension tokens (#169)", () => {
  it("lets a valid token through and records its use", async () => {
    const token = await createExtensionToken(userId);
    expect(token).toMatch(/^lkx_/);
    const res = await call(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "eric@example.com" });
    const s = await extensionStatus(userId);
    expect(s.connected).toBe(true);
    expect(s.lastUsedAt).toBeInstanceOf(Date);
  });

  it("stores only the hash", async () => {
    const token = await createExtensionToken(userId);
    const rows = await db.select().from(schema.extensionTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toContain(token.slice(4));
  });

  it("refuses a missing, wrong, replaced or revoked token", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("lkx_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(401);
    const old = await createExtensionToken(userId);
    const fresh = await createExtensionToken(userId);
    expect((await call(old)).status).toBe(401);
    expect((await call(fresh)).status).toBe(200);
    await revokeExtensionToken(userId);
    expect((await call(fresh)).status).toBe(401);
    expect((await extensionStatus(userId)).connected).toBe(false);
  });

  it("refuses disabled people, and hides itself when auto-apply is off for them", async () => {
    const token = await createExtensionToken(userId);
    process.env.FEATURE_AUTO_APPLY = "off";
    expect((await call(token)).status).toBe(404);
    process.env.FEATURE_AUTO_APPLY = "on";
    await db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, userId));
    expect((await call(token)).status).toBe(401);
  });
});
