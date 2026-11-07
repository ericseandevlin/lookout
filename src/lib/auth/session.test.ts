import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { hashToken } from "./crypto";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

// A cookie jar standing in for next/headers, so tests can read what the code set.
type Cookie = { value: string; opts: Record<string, unknown> };
const jar = new Map<string, Cookie>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "TestBrowser/1.0" }),
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)!.value } : undefined),
    set: (n: string, value: string, opts: Record<string, unknown>) => jar.set(n, { value, opts }),
    delete: (n: string) => jar.delete(n),
  }),
}));

const { SESSION_COOKIE, createSession, currentSessionHash, destroySession, getSessionUser, refreshSession } = await import("./session");

const DAY = 864e5;
let userId: string;

const sessionRow = async (token: string) => (await db.select().from(schema.sessions).where(eq(schema.sessions.idHash, hashToken(token))))[0];
const signIn = async (token: string, expiresAt: Date, uid = userId) => {
  await db.insert(schema.sessions).values({ idHash: hashToken(token), userId: uid, expiresAt });
  jar.set(SESSION_COOKIE, { value: token, opts: {} });
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  jar.clear();
  vi.unstubAllEnvs();
  await db.delete(schema.sessions);
  await db.delete(schema.users);
  [{ id: userId }] = await db.insert(schema.users).values({ email: "me@example.com" }).returning();
});

describe("createSession", () => {
  it("stores only the token's hash and sets an httpOnly cookie 30 days out", async () => {
    await createSession(userId);
    const c = jar.get(SESSION_COOKIE)!;
    expect(c.value).toMatch(/^[\w-]{43}$/);
    const rows = await db.select().from(schema.sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].idHash).toBe(hashToken(c.value));
    expect(rows[0].idHash).not.toBe(c.value);
    expect(rows[0]).toMatchObject({ userId, userAgent: "TestBrowser/1.0" });
    expect(Math.abs(rows[0].expiresAt.getTime() - (Date.now() + 30 * DAY))).toBeLessThan(60_000);
    expect(c.opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", expires: rows[0].expiresAt });
  });

  it("marks the cookie secure only when the app is on https", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    await createSession(userId);
    expect(jar.get(SESSION_COOKIE)!.opts.secure).toBe(false);
    vi.stubEnv("APP_URL", "https://lookout.test");
    await createSession(userId);
    expect(jar.get(SESSION_COOKIE)!.opts.secure).toBe(true);
  });
});

describe("getSessionUser", () => {
  it("returns the user for a live session", async () => {
    await createSession(userId);
    expect((await getSessionUser())?.email).toBe("me@example.com");
  });

  it("returns null with no cookie or an unknown token", async () => {
    expect(await getSessionUser()).toBeNull();
    jar.set(SESSION_COOKIE, { value: "not-a-real-token", opts: {} });
    expect(await getSessionUser()).toBeNull();
  });

  it("returns null once the session has expired", async () => {
    await signIn("old", new Date(Date.now() - 1000));
    expect(await getSessionUser()).toBeNull();
  });

  it("keeps a disabled user out", async () => {
    await createSession(userId);
    await db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, userId));
    expect(await getSessionUser()).toBeNull();
  });

  it("matches the session to its own user", async () => {
    const [other] = await db.insert(schema.users).values({ email: "other@example.com" }).returning();
    await signIn("mine", new Date(Date.now() + DAY));
    await db.insert(schema.sessions).values({ idHash: hashToken("theirs"), userId: other.id, expiresAt: new Date(Date.now() + DAY) });
    expect((await getSessionUser())?.id).toBe(userId);
  });
});

describe("refreshSession", () => {
  it("slides an older session back out to 30 days and resets the cookie", async () => {
    await signIn("tok", new Date(Date.now() + 10 * DAY));
    await refreshSession();
    const row = await sessionRow("tok");
    expect(Math.abs(row.expiresAt.getTime() - (Date.now() + 30 * DAY))).toBeLessThan(60_000);
    expect(row.lastSeenAt).not.toBeNull();
    expect(jar.get(SESSION_COOKIE)!.opts.expires).toEqual(row.expiresAt);
  });

  it("does nothing when it was already pushed out within the last day", async () => {
    const recent = new Date(Date.now() + 30 * DAY - 3600_000);
    await signIn("tok", recent);
    await refreshSession();
    expect((await sessionRow("tok")).expiresAt).toEqual(recent);
    expect(jar.get(SESSION_COOKIE)!.opts).toEqual({});
  });

  it("never revives an expired session", async () => {
    const gone = new Date(Date.now() - 1000);
    await signIn("tok", gone);
    await refreshSession();
    expect((await sessionRow("tok")).expiresAt).toEqual(gone);
    expect(await getSessionUser()).toBeNull();
  });

  it("does nothing with no cookie", async () => {
    await expect(refreshSession()).resolves.toBeUndefined();
    expect(jar.size).toBe(0);
  });
});

describe("destroySession and currentSessionHash", () => {
  it("currentSessionHash is the stored hash of this device's session", async () => {
    expect(await currentSessionHash()).toBeNull();
    await createSession(userId);
    const [row] = await db.select().from(schema.sessions);
    expect(await currentSessionHash()).toBe(row.idHash);
  });

  it("signs out this device only: its row and cookie go, other sessions stay", async () => {
    await signIn("other-device", new Date(Date.now() + DAY));
    await createSession(userId);
    await destroySession();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    const rows = await db.select().from(schema.sessions);
    expect(rows.map((r) => r.idHash)).toEqual([hashToken("other-device")]);
    expect(await getSessionUser()).toBeNull();
  });
});
