import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

vi.mock("server-only", () => ({}));
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

const { pickActiveSearch, listSearches, getActiveSearch, createSearch, setActiveSearch, renameSearch, defaultSearchName } = await import("./searches");

let userId = "";
let otherUser = "";

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  const [u] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [o] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
  userId = u.id;
  otherUser = o.id;
  await db.insert(schema.settings).values({ userId });
});
afterAll(async () => {
  await pg.close();
});

describe("pickActiveSearch (#8)", () => {
  const s = [{ id: "one" }, { id: "two" }];
  it("prefers the setting, then the oldest search", () => {
    expect(pickActiveSearch(s, "two")?.id).toBe("two");
    expect(pickActiveSearch(s, null)?.id).toBe("one");
    expect(pickActiveSearch(s, "gone")?.id).toBe("one");
    expect(pickActiveSearch([], "x")).toBeNull();
  });
});

describe("searches per account (#8)", () => {
  it("creates a search, makes it active, and defaults its name by kind", async () => {
    const first = await createSearch(userId, "job");
    expect(first.name).toBe("Job search");
    expect((await getActiveSearch(userId))?.id).toBe(first.id);
    const second = await createSearch(userId, "job");
    expect(second.name).toBe("Job search 2");
    expect((await getActiveSearch(userId))?.id).toBe(second.id);
    // Another account's searches can't be picked.
    expect(await setActiveSearch(otherUser, second.id)).toBe(false);
    expect(await setActiveSearch(userId, first.id)).toBe(true);
    expect((await getActiveSearch(userId))?.id).toBe(first.id);
    expect((await listSearches(otherUser)).length).toBe(0);
  });
  it("renames only the account's own search", async () => {
    const [s] = await listSearches(userId);
    expect(await renameSearch(userId, s.id, "Product roles")).toBe(true);
    expect((await getActiveSearch(userId))?.name).toBe("Product roles");
    expect(await renameSearch(otherUser, s.id, "Nope")).toBe(false);
    expect((await getActiveSearch(userId))?.name).toBe("Product roles");
  });
  it("falls back to the oldest search when the setting points at a deleted search", async () => {
    const [first] = await listSearches(userId);
    const [second] = (await listSearches(userId)).filter((s) => s.id !== first.id);
    expect(await setActiveSearch(userId, second.id)).toBe(true);
    await db.delete(schema.searches).where(eq(schema.searches.id, second.id));
    const active = await getActiveSearch(userId);
    expect(active?.id).toBe(first.id);
  });
  it("numbers default names past the ones taken", () => {
    expect(defaultSearchName("rfp", [])).toBe("RFP search");
    expect(defaultSearchName("rfp", [{ name: "RFP search" }])).toBe("RFP search 2");
    expect(defaultSearchName("job", [{ name: "Job search" }, { name: "Job search 2" }])).toBe("Job search 3");
  });
});