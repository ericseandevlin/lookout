import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
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
let beta = true;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => current, refreshSession: async () => {} }));
vi.mock("@/lib/apply", () => ({ canUseAutoApply: () => beta }));

const { GET, PUT } = await import("./route");

const put = (data: unknown) =>
  PUT(new Request("https://lookout.test/api/profile/stories", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {});
const get = () => GET(new Request("https://lookout.test/api/profile/stories"), {});
const saved = async () => (await db.select().from(schema.profiles).where(eq(schema.profiles.userId, current!.id)))[0].personalStories;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  beta = true;
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  await db.insert(schema.profiles).values({ userId: current.id });
});

describe("/api/profile/stories (#155)", () => {
  it("starts empty, adds, edits and forgets a story", async () => {
    expect(await (await get()).json()).toEqual({ stories: [] });
    expect((await put({ theme: "health", story: "My mom's insulin pump ran on their software." })).status).toBe(200);
    const [s] = await saved();
    expect(s).toMatchObject({ theme: "health", story: "My mom's insulin pump ran on their software." });
    await put({ id: s.id, theme: "family", story: "Edited" });
    expect(await saved()).toEqual([expect.objectContaining({ id: s.id, theme: "family", story: "Edited" })]);
    await put({ id: s.id, forget: true });
    expect(await saved()).toEqual([]);
  });

  it("refuses an empty story or an unknown theme", async () => {
    expect((await put({ theme: "health", story: "   " })).status).toBe(400);
    expect((await put({ theme: "sports", story: "A real one" })).status).toBe(400);
    expect(await saved()).toEqual([]);
  });

  it("is hidden without the auto-apply beta", async () => {
    beta = false;
    expect((await get()).status).toBe(404);
    expect((await put({ theme: "health", story: "x" })).status).toBe(404);
  });
});
