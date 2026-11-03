import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

vi.mock("@/lib/application/run", () => ({ kick: vi.fn() }));
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

const { funnel } = await import("./funnel");
const { track } = await import("./events");
const { saveAutoApplySettings } = await import("./apply");

const user = async (email: string, extra: Partial<typeof schema.users.$inferInsert> = {}) => {
  const [u] = await db.insert(schema.users).values({ email, ...extra } as typeof schema.users.$inferInsert).returning();
  await db.insert(schema.profiles).values({ userId: u.id });
  return u.id;
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});

describe("onboarding funnel (#35)", () => {
  it("finds the first step each person hasn't reached, from the tables that already record it", async () => {
    await user("new@example.com");
    // Stuck the way Melissa was: profile and resume done, no search yet.
    const stuck = await user("stuck@example.com", { onboardedAt: new Date() });
    await db.update(schema.profiles).set({ savedAt: new Date() }).where(eq(schema.profiles.userId, stuck));
    await db.insert(schema.materials).values({ userId: stuck, kind: "resume" } as typeof schema.materials.$inferInsert);
    await db.update(schema.profiles).set({ searchProfileAt: new Date() }).where(eq(schema.profiles.userId, stuck));
    // A resume read is a run too, but not a search.
    await db.insert(schema.runs).values({ userId: stuck, trigger: "resume" });
    await user("admin@example.com", { isAdmin: true, onboardedAt: new Date() });
    await user("gone@example.com", { disabled: true });

    const f = await funnel();
    const by = Object.fromEntries(f.people.map((p) => [p.email, p]));
    expect(by["new@example.com"].stuckAt).toBe("welcome");
    expect(by["stuck@example.com"].stuckAt).toBe("search");
    expect(by["gone@example.com"]).toBeUndefined();
    const reached = Object.fromEntries(f.steps.map((s) => [s.key, s.reached]));
    // The admin is listed but not counted.
    expect(reached).toMatchObject({ joined: 2, welcome: 1, searchProfile: 1, search: 0 });
  });

  it("records events, and auto-apply only when it actually flips", async () => {
    const id = await user("events@example.com");
    await track(id, "signed_in");
    await saveAutoApplySettings(id, { enabled: true });
    await saveAutoApplySettings(id, { enabled: true, dailyCap: 2 });
    await saveAutoApplySettings(id, { enabled: false });
    const rows = await db.select({ type: schema.events.type }).from(schema.events).where(eq(schema.events.userId, id)).orderBy(schema.events.at);
    expect(rows.map((r) => r.type)).toEqual(["signed_in", "auto_apply_on", "auto_apply_off"]);
  });
});
