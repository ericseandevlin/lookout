import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});

const { referralLink, referrerOf } = await import("./referral");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});

describe("referral links (#527)", () => {
  it("makes a code once and keeps it, as a landing link the channel slug leaves alone", async () => {
    const [u] = await db.insert(schema.users).values({ email: "paul@example.com" }).returning();
    const link = await referralLink(u.id);
    expect(link).toMatch(/^https:\/\/lookout\.test\/\?ref=r-[0-9a-f]{10}$/);
    expect(await referralLink(u.id)).toBe(link);
  });

  it("finds the referrer from the slug, and ignores other channels and disabled accounts", async () => {
    const [u] = await db.insert(schema.users).values({ email: "jeff@example.com", referralCode: "abc123" }).returning();
    await db.insert(schema.users).values({ email: "gone@example.com", referralCode: "dead00", disabled: true });
    expect(await referrerOf("r-abc123")).toBe(u.id);
    expect(await referrerOf("r-dead00")).toBeNull();
    expect(await referrerOf("r-nobody")).toBeNull();
    expect(await referrerOf("reddit")).toBeNull();
    expect(await referrerOf(null)).toBeNull();
  });
});
