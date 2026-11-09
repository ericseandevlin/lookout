import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const { GET, PUT } = await import("./route");

const get = () => GET(new Request("https://lookout.test/api/networking-events"), {});
const put = (data: unknown) =>
  PUT(new Request("https://lookout.test/api/networking-events", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {});
/** YYYY-MM-DD, n days from today. */
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const event = (title: string, values: Partial<typeof schema.networkingEvents.$inferInsert> = {}) =>
  db.insert(schema.networkingEvents).values({ userId: current!.id, title, startsOn: day(3), url: `https://events.example.com/${title}`, fingerprint: title, ...values });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_EVENTS = "on";
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  await db.insert(schema.profiles).values({ userId: current.id });
});
afterEach(() => {
  delete process.env.FEATURE_EVENTS;
});

describe("/api/networking-events (#7, #265, #545)", () => {
  it("is not found with the EVENTS feature off, and needs a session", async () => {
    delete process.env.FEATURE_EVENTS;
    expect((await get()).status).toBe(404);
    expect((await put({ interests: "AI", reach: "both", miles: 25 })).status).toBe(404);
    process.env.FEATURE_EVENTS = "on";
    current = null;
    expect((await get()).status).toBe(401);
  });

  it("lists upcoming events by date, keeps pinned and archived, and drops dismissed and past ones", async () => {
    await event("later", { startsOn: day(10), pinned: true });
    await event("soon", { startsOn: day(1), archived: true });
    await event("gone", { startsOn: day(2), dismissed: true });
    await event("past", { startsOn: day(-3) });
    await event("still-on", { startsOn: day(-2), endsOn: day(1) });
    const { events, searching } = await (await get()).json();
    expect(events.map((e: { title: string }) => e.title)).toEqual(["still-on", "soon", "later"]);
    expect(events.find((e: { title: string }) => e.title === "later").pinned).toBe(true);
    expect(events.find((e: { title: string }) => e.title === "soon").archived).toBe(true);
    expect(searching).toBe(false);
    // Past events are deleted on read, not just hidden.
    expect((await db.select().from(schema.networkingEvents)).map((e) => e.title).sort()).toEqual(["gone", "later", "soon", "still-on"]);
  });

  it("says when an event search is running", async () => {
    await db.insert(schema.runs).values({ userId: current!.id, trigger: "events", status: "running" });
    expect((await (await get()).json()).searching).toBe(true);
  });

  it("returns default prefs when there is no profile row yet", async () => {
    await db.delete(schema.profiles);
    expect((await (await get()).json()).prefs).toEqual({ interests: "", reach: "both", miles: 25, freq: "weekly" });
  });

  it("saves preferences, with weekly as the default frequency", async () => {
    const res = await put({ interests: "  design systems, AI  ", reach: "nearby", miles: 50 });
    expect(res.status).toBe(200);
    expect((await res.json()).prefs).toEqual({ interests: "design systems, AI", reach: "nearby", miles: 50, freq: "weekly" });
    await put({ interests: "AI", reach: "online", miles: 10, freq: "monthly" });
    const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, current!.id));
    expect(p).toMatchObject({ eventInterests: "AI", eventReach: "online", eventMiles: 10, eventFreq: "monthly" });
  });

  it("refuses a reach, distance or frequency outside the allowed lists", async () => {
    expect((await put({ interests: "AI", reach: "anywhere", miles: 25 })).status).toBe(400);
    expect((await put({ interests: "AI", reach: "both", miles: 30 })).status).toBe(400);
    expect((await put({ interests: "AI", reach: "both", miles: 25, freq: "daily" })).status).toBe(400);
    expect((await put({ interests: "x".repeat(301), reach: "both", miles: 25 })).status).toBe(400);
  });
});
