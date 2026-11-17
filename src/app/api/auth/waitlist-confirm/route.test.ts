import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { confirmToken } from "@/lib/waitlist";

const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
  process.env.APP_SECRET = "s".repeat(32);
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));

const { POST } = await import("./route");
const confirm = (t: string) => POST(new Request(`https://lookout.test/api/auth/waitlist-confirm?t=${encodeURIComponent(t)}`, { method: "POST" }), {});
const row = async () => (await db.select().from(schema.accessRequests))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.accessRequests);
});

describe("POST /api/auth/waitlist-confirm (#9)", () => {
  it("marks the request confirmed, and a second click keeps the first time", async () => {
    await db.insert(schema.accessRequests).values({ email: "maya@example.com" });
    const t = confirmToken("s".repeat(32), "maya@example.com");
    expect((await confirm(t)).status).toBe(200);
    const first = (await row()).confirmedAt!;
    expect(first).toBeInstanceOf(Date);
    expect((await confirm(t)).status).toBe(200);
    expect((await row()).confirmedAt).toEqual(first);
  });

  it("refuses a bad token and changes nothing", async () => {
    await db.insert(schema.accessRequests).values({ email: "maya@example.com" });
    expect((await confirm(confirmToken("t".repeat(32), "maya@example.com"))).status).toBe(400);
    expect((await confirm("junk")).status).toBe(400);
    expect((await row()).confirmedAt).toBeNull();
  });

  it("says so when the request is gone", async () => {
    expect((await confirm(confirmToken("s".repeat(32), "lee@example.com"))).status).toBe(404);
  });
});
