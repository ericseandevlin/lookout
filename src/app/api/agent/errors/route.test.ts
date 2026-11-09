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
const TOKEN = "e".repeat(40);
vi.hoisted(() => {
  process.env.AGENT_TOKEN = "t".repeat(40);
  process.env.AGENT_ERRORS_TOKEN = "e".repeat(40);
});
let auth = `Bearer ${TOKEN}`;
vi.mock("next/headers", () => ({ headers: async () => new Headers({ authorization: auth }) }));

const { GET } = await import("./route");
const get = (q = "") => GET(new Request(`https://lookout.test/api/agent/errors${q}`), {});
const err = (message: string, at: string) => db.insert(schema.serverErrors).values({ source: "route", message, path: "/api/x", method: "GET", at: new Date(at) });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  auth = `Bearer ${TOKEN}`;
  process.env.AGENT_ERRORS_TOKEN = TOKEN;
  await db.delete(schema.serverErrors);
});

describe("GET /api/agent/errors (#486)", () => {
  it("is a 404 when AGENT_ERRORS_TOKEN is unset, as on prod", async () => {
    delete process.env.AGENT_ERRORS_TOKEN;
    expect((await get()).status).toBe(404);
  });

  it("refuses a wrong token and the general agent token", async () => {
    auth = `Bearer ${TOKEN.slice(1)}x`;
    expect((await get()).status).toBe(401);
    auth = `Bearer ${"t".repeat(40)}`;
    expect((await get()).status).toBe(401);
  });

  it("lists errors newest first, filters by since and caps the limit", async () => {
    await err("Old", "2026-11-01T00:00:00Z");
    await err("New", "2026-11-07T00:00:00Z");
    const all = await (await get()).json();
    expect(all.errors.map((e: { message: string }) => e.message)).toEqual(["New", "Old"]);
    expect(all.errors[0]).toMatchObject({ source: "route", path: "/api/x", method: "GET" });
    const since = await (await get("?since=2026-11-05T00:00:00Z")).json();
    expect(since.errors.map((e: { message: string }) => e.message)).toEqual(["New"]);
    expect((await (await get("?limit=1")).json()).errors).toHaveLength(1);
  });

  it("rejects a bad since", async () => {
    expect((await get("?since=yesterday")).status).toBe(400);
  });
});
