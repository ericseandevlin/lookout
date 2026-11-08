import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// Current pay (#109) and EEO answers (#122) are encrypted at rest and only decrypted for their owner.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.mock("server-only", () => ({}));

const { loadCurrentComp, saveCurrentComp } = await import("./currentCompStore");
const { loadEeo, saveEeo } = await import("./application/eeoStore");

const A = "a".repeat(32);
const B = "b".repeat(32);
let n = 0;
const newUser = async (withProfile = true) => {
  const [u] = await db.insert(schema.users).values({ email: `p${++n}@example.com` }).returning();
  if (withProfile) await db.insert(schema.profiles).values({ userId: u.id });
  return u.id;
};
const row = async (userId: string) => (await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
beforeEach(() => vi.stubEnv("APP_SECRET", A));
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await pg.close();
});

describe("current pay store", () => {
  it("stores ciphertext and reads back the amount", async () => {
    const id = await newUser();
    await saveCurrentComp(id, 185000);
    const stored = (await row(id)).currentComp!;
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain("185000");
    expect(await loadCurrentComp(id)).toBe(185000);
  });

  it("creates the profile row when there is none", async () => {
    const id = await newUser(false);
    await saveCurrentComp(id, 90000);
    expect(await loadCurrentComp(id)).toBe(90000);
  });

  it("is null after a delete, with no value, or for no profile", async () => {
    const id = await newUser();
    expect(await loadCurrentComp(id)).toBeNull();
    await saveCurrentComp(id, 120000);
    await saveCurrentComp(id, null);
    expect((await row(id)).currentComp).toBeNull();
    expect(await loadCurrentComp(id)).toBeNull();
    expect(await loadCurrentComp(await newUser(false))).toBeNull();
  });

  it("treats a value sealed under another key as gone", async () => {
    const id = await newUser();
    await saveCurrentComp(id, 150000);
    vi.stubEnv("APP_SECRET", B);
    expect(await loadCurrentComp(id)).toBeNull();
  });
});

describe("EEO store", () => {
  const profile = { answers: { veteran: "I am not a protected veteran" }, exact: { "Are you a veteran?": "No" } };

  it("stores ciphertext and reads back answers and consent", async () => {
    const id = await newUser();
    await saveEeo(id, { profile, consent: true });
    const stored = (await row(id)).eeo!;
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain("veteran");
    expect(await loadEeo(id)).toEqual({ consent: true, profile });
  });

  it("changes only what the patch names", async () => {
    const id = await newUser();
    await saveEeo(id, { profile, consent: true });
    await saveEeo(id, { consent: false });
    expect(await loadEeo(id)).toEqual({ consent: false, profile });
    await saveEeo(id, {});
    expect((await loadEeo(id)).profile).toEqual(profile);
  });

  it("is empty after a delete or before any answers", async () => {
    const id = await newUser();
    expect(await loadEeo(id)).toEqual({ consent: false, profile: { answers: {}, exact: {} } });
    await saveEeo(id, { profile, consent: true });
    await saveEeo(id, { profile: null, consent: false });
    expect((await row(id)).eeo).toBeNull();
    expect(await loadEeo(id)).toEqual({ consent: false, profile: { answers: {}, exact: {} } });
  });

  it("treats answers sealed under another key as gone", async () => {
    const id = await newUser();
    await saveEeo(id, { profile, consent: true });
    vi.stubEnv("APP_SECRET", B);
    expect(await loadEeo(id)).toEqual({ consent: true, profile: { answers: {}, exact: {} } });
  });

  it("saves nothing without a profile row; every account gets one when it is created (users.ts)", async () => {
    const id = await newUser(false);
    await saveEeo(id, { profile, consent: true });
    expect(await row(id)).toBeUndefined();
    expect(await loadEeo(id)).toEqual({ consent: false, profile: { answers: {}, exact: {} } });
  });
});
