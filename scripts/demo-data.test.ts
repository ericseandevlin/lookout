import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { needsConsent } from "@/lib/legal";
import { DEMO_EMAIL, DEMO_FINDS, DEMO_NAME, seedDemo } from "./demo-data";

// An in-process Postgres with the real migrations, standing in for a local dev database.
const pg = new PGlite();
const db = drizzle(pg, { schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });
});
afterAll(async () => {
  await pg.close();
});

describe("demo seed (#415)", () => {
  it("builds Maya's account with the eight README finds, and a re-run rebuilds it instead of duplicating", async () => {
    const now = new Date("2026-11-08T12:00:00Z");
    await seedDemo(db, DEMO_EMAIL, now);
    const second = await seedDemo(db, "Demo@Example.com", now);

    const users = await db.select().from(schema.users);
    expect(users).toHaveLength(1);
    const [u] = users;
    expect(u).toMatchObject({ id: second.userId, email: DEMO_EMAIL, name: DEMO_NAME, isAdmin: false });
    expect(u.onboardedAt).not.toBeNull();
    expect(needsConsent(u)).toBe(false);

    const [settings] = await db.select().from(schema.settings).where(eq(schema.settings.userId, u.id));
    expect(settings.activeSearchId).toBe(second.searchId);
    const [search] = await db.select().from(schema.searches).where(eq(schema.searches.id, second.searchId));
    expect(search.savedAt).not.toBeNull();
    expect(search.searchProfile?.targetTitles.length).toBeGreaterThan(0);
    const mats = await db.select().from(schema.materials);
    expect(mats).toMatchObject([{ userId: u.id, kind: "resume", status: "done" }]);

    expect(await db.select().from(schema.opportunities)).toHaveLength(DEMO_FINDS.length);
    const board = await db.select().from(schema.userOpportunities).where(eq(schema.userOpportunities.searchId, second.searchId));
    expect(board).toHaveLength(8);
    expect(board.filter((r) => r.seenAt === null)).toHaveLength(3);
    expect(board.map((r) => r.score).sort()).toEqual([2, 3, 4, 4, 4, 4, 5, 5]);

    const runs = await db.select().from(schema.runs).where(eq(schema.runs.userId, u.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "done", added: 8 });
    expect(runs[0].report?.tally.added).toBe(8);
  });

  it("dates postings relative to today, so the board always reads as fresh", async () => {
    const now = new Date("2027-03-01T12:00:00Z");
    await seedDemo(db, DEMO_EMAIL, now);
    const [opp] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.company, "Harbor Hall"));
    expect(opp.postedAt).toBe("2027-02-28");
  });

  it("refuses an email that belongs to someone else, and leaves their account alone", async () => {
    const [real] = await db.insert(schema.users).values({ email: "real@example.com", name: "Sam" }).returning();
    await expect(seedDemo(db, "real@example.com")).rejects.toThrow(/isn't the demo one/);
    const [still] = await db.select().from(schema.users).where(eq(schema.users.id, real.id));
    expect(still.name).toBe("Sam");
  });

  it("lists each company once, each with a real job stage", () => {
    const companies = DEMO_FINDS.map((f) => f.company);
    expect(new Set(companies).size).toBe(companies.length);
    for (const f of DEMO_FINDS) expect(schema.STAGES).toContain(f.stage);
  });
});
