import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://lookout.test" }),
}));
type User = typeof schema.users.$inferSelect;
let me: User | null = null;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => me,
  refreshSession: async () => {},
}));

const { GET } = await import("./route");

const get = () => GET(new Request("https://lookout.test/api/export"), {});
const user = async (email: string) =>
  (
    await db
      .insert(schema.users)
      .values({ email, name: email.split("@")[0] })
      .returning()
  )[0];
const search = async (u: User, name: string, kind = "job") =>
  (
    await db
      .insert(schema.searches)
      .values({ userId: u.id, name, kind, answers: { role: `${name} role` } })
      .returning()
  )[0];
async function find(u: User, searchId: string, company: string, notes = "") {
  const [o] = await db
    .insert(schema.opportunities)
    .values({
      type: "job",
      company,
      title: "Designer",
      fingerprint: crypto.randomUUID(),
    })
    .returning();
  await db
    .insert(schema.userOpportunities)
    .values({ userId: u.id, searchId, opportunityId: o.id, score: 80, notes });
}

let alice: User, bob: User;
let aliceJobs: typeof schema.searches.$inferSelect,
  aliceGrants: typeof schema.searches.$inferSelect;

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../../../drizzle"),
  });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  alice = await user("alice@example.com");
  bob = await user("bob@example.com");
  aliceJobs = await search(alice, "Jobs");
  aliceGrants = await search(alice, "Grants", "grant");
  await db
    .insert(schema.settings)
    .values({ userId: alice.id, activeSearchId: aliceJobs.id });
  await find(alice, aliceJobs.id, "Acme", "Call Sam on Monday");
  await find(alice, aliceGrants.id, "Arts Fund");
  await find(bob, (await search(bob, "Bob jobs")).id, "Bob Corp");
  await db.insert(schema.events).values([
    { userId: alice.id, type: "find.pinned" },
    { userId: bob.id, type: "find.archived" },
  ]);
  await db
    .insert(schema.sessions)
    .values({
      idHash: "f".repeat(64),
      userId: alice.id,
      expiresAt: new Date(Date.now() + 864e5),
    });
  me = alice;
});

describe("GET /api/export (#468)", () => {
  it("needs a session", async () => {
    me = null;
    expect((await get()).status).toBe(401);
  });

  it("downloads as a file that no cache keeps", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="lookout-export.json"',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("holds the board, notes, profile and events", async () => {
    const data = await (await get()).json();
    expect(data.user).toMatchObject({
      email: "alice@example.com",
      name: "alice",
    });
    expect(
      data.finds.map((f: { company: string; notes: string }) => [
        f.company,
        f.notes,
      ]),
    ).toEqual([["Acme", "Call Sam on Monday"]]);
    expect(data.profile.answers).toEqual({ role: "Jobs role" });
    expect(data.events.map((e: { type: string }) => e.type)).toEqual([
      "find.pinned",
    ]);
    expect(Date.parse(data.exportedAt)).not.toBeNaN();
  });

  it("holds every search, not only the one on the board", async () => {
    const data = await (await get()).json();
    expect(data.searches).toEqual([
      expect.objectContaining({
        id: aliceJobs.id,
        name: "Jobs",
        kind: "job",
        active: true,
        profile: { answers: { role: "Jobs role" }, savedAt: null },
      }),
      expect.objectContaining({
        id: aliceGrants.id,
        name: "Grants",
        kind: "grant",
        active: false,
        profile: { answers: { role: "Grants role" }, savedAt: null },
      }),
    ]);
    expect(
      data.searches.map((s: { finds: { company: string }[] }) =>
        s.finds.map((f) => f.company),
      ),
    ).toEqual([["Acme"], ["Arts Fund"]]);
  });

  it("holds nothing of anyone else's and no session secrets", async () => {
    const text = await (await get()).text();
    for (const leak of [
      "bob@example.com",
      "Bob Corp",
      "Bob jobs",
      "find.archived",
      bob.id,
      "f".repeat(64),
    ]) {
      expect(text).not.toContain(leak);
    }
  });
});
