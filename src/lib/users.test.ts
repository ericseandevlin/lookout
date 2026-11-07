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
let signupMode: "open" | "invite" = "invite";
vi.mock("@/lib/config", () => ({ getAccessConfig: async () => ({ signupMode, dailyBudgetUsd: 10, userDailyBudgetUsd: 2 }) }));

const { ensureUser, isAdmin, mayLogIn } = await import("./users");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  signupMode = "invite";
  vi.stubEnv("ALLOWED_EMAILS", "");
  vi.stubEnv("ADMIN_EMAILS", "");
  await db.delete(schema.invites);
  await db.delete(schema.accessRequests);
  await db.delete(schema.users);
});

describe("mayLogIn", () => {
  it("lets an existing user in unless they're disabled", async () => {
    await db.insert(schema.users).values([{ email: "on@example.com" }, { email: "off@example.com", disabled: true }]);
    expect(await mayLogIn(" ON@example.com ")).toBe(true);
    expect(await mayLogIn("off@example.com")).toBe(false);
  });

  it("refuses a stranger in invite mode and lets them in when sign-up is open", async () => {
    expect(await mayLogIn("new@example.com")).toBe(false);
    signupMode = "open";
    expect(await mayLogIn("new@example.com")).toBe(true);
  });

  it("lets in ALLOWED_EMAILS and ADMIN_EMAILS, whatever the case", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "Friend@Example.com");
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
    expect(await mayLogIn("friend@example.com")).toBe(true);
    expect(await mayLogIn("BOSS@example.com")).toBe(true);
  });

  it("honors an invite and refuses a revoked one", async () => {
    await db.insert(schema.invites).values([{ email: "inv@example.com" }, { email: "gone@example.com", revokedAt: new Date() }]);
    expect(await mayLogIn("Inv@Example.com")).toBe(true);
    expect(await mayLogIn("gone@example.com")).toBe(false);
  });

  it("keeps a disabled user out even with an invite or open sign-up", async () => {
    signupMode = "open";
    await db.insert(schema.users).values({ email: "off@example.com", disabled: true });
    await db.insert(schema.invites).values({ email: "off@example.com" });
    expect(await mayLogIn("off@example.com")).toBe(false);
  });
});

describe("ensureUser", () => {
  const rowsFor = async (userId: string) => ({
    settings: await db.select().from(schema.settings).where(eq(schema.settings.userId, userId)),
    searches: await db.select().from(schema.searches).where(eq(schema.searches.userId, userId)),
    profiles: await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)),
  });

  it("creates the user once, with settings, a profile and an active job search", async () => {
    const a = await ensureUser(" New@Example.com");
    const b = await ensureUser("new@example.com");
    expect(b.id).toBe(a.id);
    expect(a.email).toBe("new@example.com");
    expect(a.isAdmin).toBe(false);
    const r = await rowsFor(a.id);
    expect(r.profiles).toHaveLength(1);
    expect(r.searches).toHaveLength(1);
    expect(r.searches[0]).toMatchObject({ kind: "job", name: "Job search", answers: {} });
    expect(r.settings[0].activeSearchId).toBe(r.searches[0].id);
  });

  it("makes ADMIN_EMAILS admins", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
    expect((await ensureUser("Boss@example.com")).isAdmin).toBe(true);
  });

  it("seeds question 1 from the next move picked at request-access", async () => {
    await db.insert(schema.accessRequests).values({ email: "a@example.com", nextMove: "step_up" });
    const u = await ensureUser("a@example.com");
    const [s] = (await rowsFor(u.id)).searches;
    expect(s.answers).toEqual({ q1: "A step up to a director, head-of or VP role" });
    expect(s.autofilled).toEqual({ q1: "sign-up" });
  });

  it("gives an RFP request an RFP search, and an unknown kind a job search", async () => {
    await db.insert(schema.accessRequests).values([
      { email: "rfp@example.com", kind: "rfp", nextMove: "step_up" },
      { email: "odd@example.com", kind: "nonsense" },
    ]);
    const [rfp] = (await rowsFor((await ensureUser("rfp@example.com")).id)).searches;
    expect(rfp).toMatchObject({ kind: "rfp", name: "RFP search", answers: {} });
    const [odd] = (await rowsFor((await ensureUser("odd@example.com")).id)).searches;
    expect(odd).toMatchObject({ kind: "job", name: "Job search" });
  });
});

describe("isAdmin", () => {
  it("is true for the admin flag or an ADMIN_EMAILS address", () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
    expect(isAdmin({ isAdmin: true, email: "x@example.com" })).toBe(true);
    expect(isAdmin({ isAdmin: false, email: " Boss@Example.com" })).toBe(true);
    expect(isAdmin({ isAdmin: false, email: "x@example.com" })).toBe(false);
  });
});
