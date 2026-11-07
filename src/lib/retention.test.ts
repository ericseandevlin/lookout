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
    const [u] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
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

    expect(await cleanup(NOW)).toEqual({ loginTokens: 1, sessions: 1, runLogs: 1, errors: 0 });
    expect((await db.select().from(schema.loginTokens)).map((t) => t.tokenHash)).toEqual(["live"]);
    expect((await db.select().from(schema.sessions)).map((s) => s.idHash)).toEqual(["here"]);
    const [o] = await db.select().from(schema.runs).where(eq(schema.runs.id, old.id));
    expect(o.progress.log).toEqual([]);
    expect(o.request).toBeNull();
    expect([o.found, o.added, o.costUsd]).toEqual([9, 2, "0.0300"]);
    const [r] = await db.select().from(schema.runs).where(eq(schema.runs.id, recent.id));
    expect(r.progress.log).toHaveLength(1);

    expect(await cleanup(NOW)).toEqual({ loginTokens: 0, sessions: 0, runLogs: 0, errors: 0 });
  });
});
