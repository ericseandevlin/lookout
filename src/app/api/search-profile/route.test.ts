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
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let current: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => current, refreshSession: async () => {} }));

// The builder makes a model call; the stand-in returns whatever each test sets and records how it was asked.
type Result = { profile: unknown; rebuilt: boolean; raw: { hash: string; sources: Record<string, boolean>; stored?: { searchProfileHash?: string; searchProfileAt?: Date } }; error?: string };
let result: Result;
let aiReady = true;
const ensure = vi.fn<(...a: unknown[]) => Promise<Result>>(async () => result);
vi.mock("@/lib/agent/searchProfile", () => ({ ensureSearchProfile: (...a: unknown[]) => ensure(...a), canBuild: async () => aiReady }));

const { GET, POST } = await import("./route");

const get = () => GET(new Request("https://lookout.test/api/search-profile"), {});
const post = () => POST(new Request("https://lookout.test/api/search-profile", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), {});
const BUILT = new Date("2026-11-01T12:00:00Z");
const sources = { answers: true, resume: true, linkedin: false };

let searchId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  ensure.mockClear();
  aiReady = true;
  result = { profile: { targetTitles: ["Design lead"] }, rebuilt: false, raw: { hash: "h1", sources, stored: { searchProfileHash: "h1", searchProfileAt: BUILT } } };
  await db.delete(schema.rateLimits);
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [s] = await db.insert(schema.searches).values({ userId: current.id, name: "Job search" }).returning();
  searchId = s.id;
  await db.insert(schema.settings).values({ userId: current.id, activeSearchId: searchId });
});

describe("/api/search-profile (#8, #547)", () => {
  it("needs a session, then a search", async () => {
    current = null;
    expect((await get()).status).toBe(401);
    [current] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
    expect((await get()).status).toBe(409);
    expect(ensure).not.toHaveBeenCalled();
  });

  it("reads the active search's profile without forcing a rebuild", async () => {
    const body = await (await get()).json();
    expect(ensure).toHaveBeenCalledWith(searchId, expect.anything(), { force: false, build: true });
    expect(body).toEqual({ profile: { targetTitles: ["Design lead"] }, builtAt: BUILT.toISOString(), sources, stale: false, canBuild: true, error: null });
  });

  it("marks the profile stale when its inputs changed and nothing was rebuilt", async () => {
    result = { ...result, raw: { ...result.raw, hash: "h2" } };
    expect((await (await get()).json()).stale).toBe(true);
  });

  it("gives the rebuild time and passes a build error through", async () => {
    result = { ...result, rebuilt: true, raw: { ...result.raw, hash: "h2" }, error: "The model timed out." };
    const before = Date.now();
    const body = await (await get()).json();
    expect(body.stale).toBe(false);
    expect(Date.parse(body.builtAt)).toBeGreaterThanOrEqual(before);
    expect(body.error).toBe("The model timed out.");
  });

  it("has no built time before the first build", async () => {
    result = { profile: null, rebuilt: false, raw: { hash: "h1", sources: { answers: false, resume: false, linkedin: false } } };
    expect(await (await get()).json()).toMatchObject({ profile: null, builtAt: null, stale: false });
  });

  it("forces a rebuild on POST, and says so when the AI isn't set up", async () => {
    await post();
    expect(ensure).toHaveBeenCalledWith(searchId, expect.anything(), { force: true, build: true });
    aiReady = false;
    ensure.mockClear();
    expect((await post()).status).toBe(503);
    expect(ensure).not.toHaveBeenCalled();
    expect((await (await get()).json()).canBuild).toBe(false);
  });

  it("stops asking for builds after 30 in a day, but still answers", async () => {
    for (let i = 0; i < 30; i++) await get();
    ensure.mockClear();
    const res = await get();
    expect(res.status).toBe(200);
    expect(ensure).toHaveBeenCalledWith(searchId, expect.anything(), { force: false, build: false });
  });
});
