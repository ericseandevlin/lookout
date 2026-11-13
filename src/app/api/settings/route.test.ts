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
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => current, refreshSession: async () => {} }));

const settings = await import("./route");
const welcome = await import("../welcome/route");

const req = (url: string, method: string, data: unknown) =>
  new Request(`https://lookout.test${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
const patch = (data: unknown) => settings.PATCH(req("/api/settings", "PATCH", data), {});
const post = (data: unknown) => welcome.POST(req("/api/welcome", "POST", data), {});
const row = async () => (await db.select().from(schema.settings).where(eq(schema.settings.userId, current!.id)))[0];
const me = async () => (await db.select().from(schema.users).where(eq(schema.users.id, current!.id)))[0];
const addSearch = async (kind: string, answers = {}) => {
  const [s] = await db.insert(schema.searches).values({ userId: current!.id, name: "Search", kind, answers }).returning();
  return s;
};
const searchAnswers = async (id: string) => (await db.select().from(schema.searches).where(eq(schema.searches.id, id)))[0].answers;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
});

describe("PATCH /api/settings", () => {
  it("needs a signed-in person", async () => {
    current = null;
    expect((await patch({ digest: false })).status).toBe(401);
  });

  it("creates the row on first save and keeps defaults for fields not sent", async () => {
    expect(await (await patch({ freq: "Daily", density: "Compact" })).json()).toEqual({ ok: true });
    const s = await row();
    expect([s.freq, s.density, s.runDay, s.digest, s.newDays]).toEqual(["Daily", "Compact", "Mon", true, 7]);
  });

  it("updates only the fields sent, mapping day, days and setup to their columns", async () => {
    await patch({ freq: "Twice a week", digest: false });
    await patch({ day: "Wed", days: ["Tue", "Fri"], setup: "Never", newDays: 14, railClosed: true });
    const s = await row();
    expect([s.freq, s.digest, s.runDay, s.runDays, s.setupMode, s.newDays, s.railClosed]).toEqual([
      "Twice a week",
      false,
      "Wed",
      ["Tue", "Fri"],
      "Never",
      14,
      true,
    ]);
  });

  it("records which settings changed, but not the sidebar (#992)", async () => {
    await patch({ freq: "Daily", digest: false });
    await patch({ railClosed: true });
    const ev = await db.select().from(schema.events).where(eq(schema.events.userId, current!.id));
    expect(ev.map((e) => [e.type, e.target]).sort()).toEqual([
      ["settings_change", "digest"],
      ["settings_change", "freq"],
    ]);
  });

  it("refuses values outside the allowed sets", async () => {
    for (const bad of [{ freq: "Hourly" }, { day: "Funday" }, { days: [] }, { days: ["Mon", "Tue", "Wed"] }, { newDays: 5 }, { digest: "yes" }]) {
      expect((await patch(bad)).status).toBe(400);
    }
    expect(await row()).toBeUndefined();
  });
});

describe("POST /api/welcome", () => {
  const ok = { name: "Ada Lovelace", agree: true };

  it("needs the agree box", async () => {
    await addSearch("job");
    expect((await post({ name: "Ada" })).status).toBe(400);
    expect((await post({ name: "Ada", agree: false })).status).toBe(400);
    expect((await me()).onboardedAt).toBeNull();
  });

  it("refuses a blank name", async () => {
    await addSearch("job");
    expect((await post({ ...ok, name: "   " })).status).toBe(400);
  });

  it("asks for a search first when the person has none", async () => {
    expect((await post(ok)).status).toBe(409);
  });

  it("saves the name, marks onboarded and accepted, and records the event", async () => {
    await addSearch("job");
    expect(await (await post({ ...ok, name: "  Ada Lovelace  " })).json()).toEqual({ ok: true });
    const u = await me();
    expect(u.name).toBe("Ada Lovelace");
    expect(u.onboardedAt).not.toBeNull();
    expect(u.acceptedAt).not.toBeNull();
    expect(u.termsVersion).toBeTruthy();
    const events = await db.select().from(schema.events).where(eq(schema.events.userId, u.id));
    expect(events.map((e) => e.type)).toEqual(["welcome_done"]);
  });

  it("pre-fills salary floor, target and work mode on a job search, keeping other answers", async () => {
    const s = await addSearch("job", { role: "Design director" });
    await post({ ...ok, salary: "170_250", mode: "Remote" });
    expect(await searchAnswers(s.id)).toMatchObject({ role: "Design director", floor: "$170,000", target: "$250,000", modes: ["Remote"] });
  });

  it("maps an old salary key to its current range", async () => {
    const s = await addSearch("job");
    await post({ ...ok, salary: "160_220" });
    expect(await searchAnswers(s.id)).toMatchObject({ floor: "$170,000", target: "$250,000" });
  });

  it("leaves a non-job search's answers alone", async () => {
    const s = await addSearch("rfp", { sector: "Arts" });
    await post({ ...ok, salary: "250p", mode: "Hybrid" });
    expect(await searchAnswers(s.id)).toEqual({ sector: "Arts" });
  });

  it("refuses an unknown salary key or work mode", async () => {
    await addSearch("job");
    expect((await post({ ...ok, salary: "1m" })).status).toBe(400);
    expect((await post({ ...ok, mode: "Moon" })).status).toBe(400);
  });
});
