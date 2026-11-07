import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let current: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => current, refreshSession: async () => {} }));

const consent = (await import("./route")).POST;
const welcome = (await import("../welcome/route")).POST;

const req = (url: string, data: unknown) =>
  new Request(`https://lookout.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
const reload = async () => (await db.select().from(schema.users).where(eq(schema.users.id, current!.id)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  await db.insert(schema.searches).values({ userId: current.id, name: "Search" });
});

describe("POST /api/consent (#21)", () => {
  it("refuses without the box ticked", async () => {
    expect((await consent(req("/api/consent", { agree: false }), {})).status).toBe(400);
    expect((await reload()).acceptedAt).toBeNull();
  });

  it("records the current versions and when", async () => {
    expect((await consent(req("/api/consent", { agree: true }), {})).status).toBe(200);
    const u = await reload();
    expect(u.privacyVersion).toBe(PRIVACY_VERSION);
    expect(u.termsVersion).toBe(TERMS_VERSION);
    expect(u.acceptedAt).toBeInstanceOf(Date);
  });
});

describe("POST /api/welcome (#21)", () => {
  it("can't finish the welcome step without agreeing", async () => {
    expect((await welcome(req("/api/welcome", { name: "Ann" }), {})).status).toBe(400);
    expect((await reload()).onboardedAt).toBeNull();
  });

  it("records agreement with the welcome step", async () => {
    expect((await welcome(req("/api/welcome", { name: "Ann", agree: true }), {})).status).toBe(200);
    const u = await reload();
    expect(u.onboardedAt).toBeInstanceOf(Date);
    expect(u.privacyVersion).toBe(PRIVACY_VERSION);
    expect(u.acceptedAt).toBeInstanceOf(Date);
  });
});
