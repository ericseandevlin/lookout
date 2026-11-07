import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.mock("server-only", () => ({}));
const sent: string[] = [];
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendMail: async (m: { to: string }) => void sent.push(m.to),
}));

const NOW = new Date("2026-11-06T12:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});

describe("cleanup", () => {
  it("drops expired links and sessions, clears run logs past 12 months, keeps the rest", async () => {
    const { cleanup } = await import("./retention");
    const [u] = await db.insert(schema.users).values({ email: "a@example.com", createdAt: ago(1) }).returning();
    await db.insert(schema.loginTokens).values([
      { tokenHash: "old", email: u.email, expiresAt: ago(1) },
      { tokenHash: "live", email: u.email, expiresAt: new Date(NOW.getTime() + 600_000) },
    ]);
    await db.insert(schema.sessions).values([
      { idHash: "gone", userId: u.id, expiresAt: ago(2) },
      { idHash: "here", userId: u.id, expiresAt: new Date(NOW.getTime() + 30 * DAY) },
    ]);
    const log = { pct: 100, step: "Done", log: [{ at: "x", text: "Searched" }] };
    const [old, recent] = await db
      .insert(schema.runs)
      .values([
        { userId: u.id, trigger: "scheduled", status: "done", startedAt: ago(400), progress: log, request: { url: "u" }, found: 9, added: 2, costUsd: "0.0300" },
        { userId: u.id, trigger: "scheduled", status: "done", startedAt: ago(30), progress: log },
      ])
      .returning();

    expect(await cleanup(NOW)).toEqual({ loginTokens: 1, sessions: 1, runLogs: 1, errors: 0, inactiveWarned: 0 });
    expect((await db.select().from(schema.loginTokens)).map((t) => t.tokenHash)).toEqual(["live"]);
    expect((await db.select().from(schema.sessions)).map((s) => s.idHash)).toEqual(["here"]);
    const [o] = await db.select().from(schema.runs).where(eq(schema.runs.id, old.id));
    expect(o.progress.log).toEqual([]);
    expect(o.request).toBeNull();
    expect([o.found, o.added, o.costUsd]).toEqual([9, 2, "0.0300"]);
    const [r] = await db.select().from(schema.runs).where(eq(schema.runs.id, recent.id));
    expect(r.progress.log).toHaveLength(1);

    expect(await cleanup(NOW)).toEqual({ loginTokens: 0, sessions: 0, runLogs: 0, errors: 0, inactiveWarned: 0 });
  });

  it("emails accounts idle 12 months once, counting use on deleted sessions, and deletes nothing", async () => {
    const { cleanup, warnInactive } = await import("./retention");
    const [idle, used, off] = await db
      .insert(schema.users)
      .values([
        { email: "idle@example.com", createdAt: ago(500), lastLoginAt: ago(400) },
        { email: "used@example.com", createdAt: ago(500), lastLoginAt: ago(400) },
        { email: "off@example.com", createdAt: ago(500), disabled: true },
      ])
      .returning();
    // Signed in 400 days ago but kept using that session until 100 days ago; it has since expired.
    await db.insert(schema.sessions).values({ idHash: "rolled", userId: used.id, expiresAt: ago(10), lastSeenAt: ago(100) });

    sent.length = 0;
    expect((await cleanup(NOW)).inactiveWarned).toBe(1);
    expect(sent).toEqual(["idle@example.com"]);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, used.id));
    expect(u.lastActiveAt).toEqual(ago(100));

    // Once per idle stretch: no second email, and a new one only after they come back and go idle again.
    expect(await warnInactive(NOW)).toBe(0);
    await db.update(schema.users).set({ lastLoginAt: new Date(NOW.getTime() + DAY) }).where(eq(schema.users.id, idle.id));
    expect(await warnInactive(new Date(NOW.getTime() + 300 * DAY))).toBe(1); // "used", idle since its session's last request
    expect(await warnInactive(new Date(NOW.getTime() + 400 * DAY))).toBe(2); // "idle" again, and the first test's account
    expect(sent.slice(1).sort()).toEqual(["a@example.com", "idle@example.com", "used@example.com"]);

    expect((await db.select().from(schema.users)).map((r) => r.id)).toEqual(expect.arrayContaining([idle.id, used.id, off.id]));
  });
});
