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
// env.appUrl reads APP_URL; set it before the route loads.
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});

const { GET } = await import("./route");

const BOARD = "https://lookout.test/finds";
const NOBODY = "00000000-0000-4000-8000-000000000000";
const go = (digest: string, target: string) => GET(new Request(`https://lookout.test/go/${digest}/${target}`), { params: Promise.resolve({ digest, target }) });
const where = (res: Response) => [res.status, res.headers.get("location")];

let userId: string;
let digestId: string;
let n = 0;
async function find(owner: string, sourceUrl: string | null, seenAt: Date | null = null) {
  const [o] = await db.insert(schema.opportunities).values({ company: "Acme", title: "Designer", sourceUrl, fingerprint: `fp-${++n}` }).returning();
  const [s] = await db.insert(schema.searches).values({ userId: owner, name: "S" }).returning();
  await db.insert(schema.userOpportunities).values({ userId: owner, searchId: s.id, opportunityId: o.id, score: 80, seenAt });
  return o.id;
}
const clicks = () => db.select().from(schema.digestClicks);
const events = () => db.select().from(schema.events).where(eq(schema.events.type, "email_click"));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  await db.delete(schema.opportunities);
  [{ id: userId }] = await db.insert(schema.users).values({ email: "maya@example.com" }).returning();
  [{ id: digestId }] = await db.insert(schema.digests).values({ userId, finds: 3 }).returning();
});

describe("GET /go/[digest]/[target]", () => {
  it("lands on the board for a malformed digest or target, without touching the database", async () => {
    expect(where(await go("nope", "board"))).toEqual([302, BOARD]);
    expect(where(await go(digestId, "https://evil.example"))).toEqual([302, BOARD]);
    expect(await clicks()).toHaveLength(0);
  });

  it("lands on the board for a digest that doesn't exist", async () => {
    expect(where(await go(NOBODY, "board"))).toEqual([302, BOARD]);
    expect(await clicks()).toHaveLength(0);
  });

  it("records the board link once per digest, however often it's clicked", async () => {
    expect(where(await go(digestId, "board"))).toEqual([302, BOARD]);
    await go(digestId, "board");
    const rows = await clicks();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ digestId, opportunityId: null });
    // Every click still counts as activity.
    expect((await events()).map((e) => e.target)).toEqual(["board", "board"]);
  });

  it("forwards a find link to its posting, records it once and marks the find seen", async () => {
    const id = await find(userId, "https://jobs.example.com/123");
    expect(where(await go(digestId, id))).toEqual([302, "https://jobs.example.com/123"]);
    await go(digestId, id);
    expect(await clicks()).toEqual([expect.objectContaining({ digestId, opportunityId: id })]);
    const [uo] = await db.select().from(schema.userOpportunities).where(eq(schema.userOpportunities.opportunityId, id));
    expect(uo.seenAt).toBeInstanceOf(Date);
    expect((await events()).map((e) => e.target)).toEqual([id, id]);
  });

  it("keeps the first seen time when the find was already seen", async () => {
    const seen = new Date("2026-10-01T12:00:00Z");
    const id = await find(userId, "https://jobs.example.com/1", seen);
    await go(digestId, id);
    const [uo] = await db.select().from(schema.userOpportunities).where(eq(schema.userOpportunities.opportunityId, id));
    expect(uo.seenAt).toEqual(seen);
  });

  it("won't forward to another person's find, even with a real digest", async () => {
    const [other] = await db.insert(schema.users).values({ email: "jeff@example.com" }).returning();
    const id = await find(other.id, "https://jobs.example.com/theirs");
    expect(where(await go(digestId, id))).toEqual([302, BOARD]);
    expect(await clicks()).toHaveLength(0);
    const [uo] = await db.select().from(schema.userOpportunities).where(eq(schema.userOpportunities.opportunityId, id));
    expect(uo.seenAt).toBeNull();
  });

  it("sends a find with no web address, or a script URL, to the board", async () => {
    const none = await find(userId, null);
    const script = await find(userId, "javascript:alert(1)");
    expect(where(await go(digestId, none))).toEqual([302, BOARD]);
    expect(where(await go(digestId, script))).toEqual([302, BOARD]);
    // Still recorded: the person did click.
    expect(await clicks()).toHaveLength(2);
  });

  it("still lands on the board when recording the click fails", async () => {
    const id = await find(userId, "https://jobs.example.com/1");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const insert = vi.spyOn(db, "insert").mockImplementation(() => {
      throw new Error("db down");
    });
    try {
      expect(where(await go(digestId, id))).toEqual([302, BOARD]);
      expect(err).toHaveBeenCalledWith("[go] click not recorded", expect.any(Error));
    } finally {
      insert.mockRestore();
      err.mockRestore();
    }
  });
});
