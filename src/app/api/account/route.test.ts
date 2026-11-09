import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
const dir = await mkdtemp(path.join(tmpdir(), "lookout-account-"));
vi.stubEnv("DATA_DIR", dir);
vi.stubEnv("APP_SECRET", "a".repeat(32));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://lookout.test" }),
}));
type User = typeof schema.users.$inferSelect;
let me: User | null = null;
const destroySession = vi.fn(async () => {});
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => me,
  refreshSession: async () => {},
  destroySession,
}));

const { DELETE } = await import("./route");
const { saveUserFile } = await import("@/lib/files");

const del = (data: unknown) =>
  DELETE(
    new Request("https://lookout.test/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }),
    {},
  );
const user = async (email: string) =>
  (await db.insert(schema.users).values({ email }).returning())[0];

/** A bit of everything a person makes in normal use: a search with a find, settings, profile, a file, events, a session. */
async function fill(u: User) {
  const [s] = await db
    .insert(schema.searches)
    .values({ userId: u.id, name: "S", kind: "job" })
    .returning();
  const [o] = await db
    .insert(schema.opportunities)
    .values({
      type: "job",
      company: "Acme",
      title: "Designer",
      fingerprint: crypto.randomUUID(),
    })
    .returning();
  await db
    .insert(schema.userOpportunities)
    .values({ userId: u.id, searchId: s.id, opportunityId: o.id, score: 80 });
  await db
    .insert(schema.settings)
    .values({ userId: u.id, activeSearchId: s.id });
  await db.insert(schema.profiles).values({ userId: u.id });
  const fileKey = await saveUserFile(u.id, Buffer.from("%PDF-1.4"), "pdf");
  await db
    .insert(schema.materials)
    .values({ userId: u.id, kind: "resume", fileName: "cv.pdf", fileKey });
  await db.insert(schema.events).values({ userId: u.id, type: "find.pinned" });
  await db
    .insert(schema.sessions)
    .values({
      idHash: crypto.randomUUID(),
      userId: u.id,
      expiresAt: new Date(Date.now() + 864e5),
    });
}

/** Every column that holds a user id, read from the live schema so new tables are covered without editing this test. */
const userColumns = async () =>
  (
    await db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public' and data_type = 'uuid' and column_name in ('user_id', 'owner_id')`,
    )
  ).rows;

/** How many rows in each such table belong to this person. */
async function rowsOf(u: User) {
  const out: Record<string, number> = {};
  for (const { table_name, column_name } of await userColumns()) {
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table_name)} where ${sql.identifier(column_name)} = ${u.id}`,
    );
    if (rows[0].n) out[table_name] = rows[0].n;
  }
  return out;
}

let alice: User, bob: User;

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../../../drizzle"),
  });
});
afterAll(async () => {
  await pg.close();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  await rm(path.join(dir, "uploads"), { recursive: true, force: true });
  destroySession.mockClear();
  alice = await user("alice@example.com");
  bob = await user("bob@example.com");
  await fill(alice);
  await fill(bob);
  me = alice;
});

describe("DELETE /api/account (#467)", () => {
  it("needs a session", async () => {
    me = null;
    expect((await del({ confirm: "DELETE" })).status).toBe(401);
    expect(Object.keys(await rowsOf(alice)).length).toBeGreaterThan(0);
  });

  it("needs the typed confirmation and keeps everything without it", async () => {
    const before = await rowsOf(alice);
    for (const data of [{}, { confirm: "delete" }, { confirm: "yes" }]) {
      expect((await del(data)).status).toBe(400);
    }
    expect(await rowsOf(alice)).toEqual(before);
    expect(destroySession).not.toHaveBeenCalled();
  });

  it("signs out and leaves no row anywhere that names the person", async () => {
    const bobBefore = await rowsOf(bob);
    const res = await del({ confirm: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(destroySession).toHaveBeenCalledOnce();
    expect(await rowsOf(alice)).toEqual({});
    expect(await rowsOf(bob)).toEqual(bobBefore);
  });

  it("removes the person's uploads and keeps everyone else's", async () => {
    await del({ confirm: "DELETE" });
    expect(await readdir(path.join(dir, "uploads"))).toEqual([bob.id]);
  });
});

describe("account deletion schema (#467)", () => {
  // Deleting the users row is the whole delete, so every user id column has to cascade (or let go of the
  // person, for audit columns like invited_by). A new table without ON DELETE fails here, not in production.
  it("every reference to users cascades or is cleared", async () => {
    const { rows } = await db.execute<{
      tbl: string;
      col: string;
      rule: string;
    }>(sql`
      select kcu.table_name as tbl, kcu.column_name as col, rc.delete_rule as rule
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu on kcu.constraint_name = rc.constraint_name
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.constraint_name
      where ccu.table_name = 'users' and ccu.column_name = 'id'`);
    expect(rows.length).toBeGreaterThan(10);
    expect(
      rows.filter((r) => r.rule !== "CASCADE" && r.rule !== "SET NULL"),
    ).toEqual([]);
  });

  it("every user_id column points at users", async () => {
    const { rows } = await db.execute<{ tbl: string }>(sql`
      select c.table_name as tbl from information_schema.columns c
      where c.table_schema = 'public' and c.column_name = 'user_id' and not exists (
        select 1 from information_schema.key_column_usage k
        join information_schema.constraint_column_usage u on u.constraint_name = k.constraint_name
        where k.table_name = c.table_name and k.column_name = 'user_id' and u.table_name = 'users')`);
    expect(rows.map((r) => r.tbl)).toEqual([]);
  });
});
