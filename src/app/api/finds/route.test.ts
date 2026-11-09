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
// The background add reads the page with the model; stand-ins record what was started.
const addByUrl = vi.fn(async () => {});
let running = false;
vi.mock("@/lib/agent/discover", () => ({ addByUrl: (...a: unknown[]) => addByUrl(...(a as [])), isRunning: async () => running }));
let ai: { provider: string; model: string | null } = { provider: "openrouter", model: "some/model" };
vi.mock("@/lib/config", () => ({ getAiConfig: async () => ai }));

const { POST } = await import("./route");

const post = (url: unknown) =>
  POST(new Request("https://lookout.test/api/finds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }), {});
const LINK = "https://jobs.example.com/roles/123";

let searchId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  addByUrl.mockClear();
  running = false;
  ai = { provider: "openrouter", model: "some/model" };
  await db.delete(schema.rateLimits);
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [s] = await db.insert(schema.searches).values({ userId: current.id, name: "Job search" }).returning();
  searchId = s.id;
  await db.insert(schema.settings).values({ userId: current.id, activeSearchId: searchId });
});

describe("POST /api/finds (#543)", () => {
  it("needs a session", async () => {
    current = null;
    expect((await post(LINK)).status).toBe(401);
  });

  it("starts the add for the active search and answers 202", async () => {
    const res = await post(`  ${LINK}  `);
    expect(res.status).toBe(202);
    expect(addByUrl).toHaveBeenCalledWith(searchId, LINK);
  });

  it("refuses something that isn't an http(s) link", async () => {
    for (const url of ["not a link", "ftp://files.example.com/a", "javascript:alert(1)"]) expect((await post(url)).status).toBe(400);
    expect(addByUrl).not.toHaveBeenCalled();
  });

  it("asks for a search first, and refuses a kind with no sources yet", async () => {
    await db.delete(schema.searches);
    expect((await post(LINK)).status).toBe(409);
    const [rfp] = await db.insert(schema.searches).values({ userId: current!.id, name: "RFP search", kind: "rfp" }).returning();
    await db.update(schema.settings).set({ activeSearchId: rfp.id });
    expect((await post(LINK)).status).toBe(400);
    expect(addByUrl).not.toHaveBeenCalled();
  });

  it("says so when no AI model is set, unless an external agent does the reading", async () => {
    ai = { provider: "openrouter", model: null };
    expect((await post(LINK)).status).toBe(503);
    ai = { provider: "agent", model: null };
    expect((await post(LINK)).status).toBe(202);
  });

  it("waits while a run is going", async () => {
    running = true;
    expect((await post(LINK)).status).toBe(409);
    expect(addByUrl).not.toHaveBeenCalled();
  });

  it("stops after 20 links in a day", async () => {
    for (let i = 0; i < 20; i++) expect((await post(`${LINK}?n=${i}`)).status).toBe(202);
    expect((await post(LINK)).status).toBe(429);
  });
});
