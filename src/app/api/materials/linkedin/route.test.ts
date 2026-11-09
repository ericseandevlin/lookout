import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let current: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => current, refreshSession: async () => {} }));

const { PUT } = await import("./route");

const put = (data: unknown) =>
  PUT(new Request("https://lookout.test/api/materials/linkedin", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {});
const rows = (userId = current!.id) =>
  db
    .select()
    .from(schema.materials)
    .where(and(eq(schema.materials.userId, userId), eq(schema.materials.kind, "linkedin")));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
});

describe("PUT /api/materials/linkedin (#549)", () => {
  it("needs a signed-in person", async () => {
    current = null;
    expect((await put({ handle: "ada" })).status).toBe(401);
  });

  it.each([
    ["ada-lovelace", "ada-lovelace"],
    ["https://www.linkedin.com/in/ada-lovelace/", "ada-lovelace"],
    ["linkedin.com/in/ada-lovelace", "ada-lovelace"],
    ["http://uk.linkedin.com/in/ada-lovelace?trk=x", "ada-lovelace"],
    ["  https://linkedin.com/in/ada-lovelace#about ", "ada-lovelace"],
  ])("saves %j as the handle %j", async (handle, saved) => {
    const res = await put({ handle });
    expect(await res.json()).toEqual({ ok: true, linked: false });
    expect((await rows()).map((r) => r.url)).toEqual([saved]);
  });

  it("marks a saved link linked, clears that for a new handle and keeps it for the same one", async () => {
    expect(await (await put({ handle: "ada", scan: true })).json()).toEqual({ ok: true, linked: true });
    const [first] = await rows();
    expect(first.scannedAt).toBeInstanceOf(Date);

    expect(await (await put({ handle: "https://linkedin.com/in/ada" })).json()).toEqual({ ok: true, linked: true });
    expect((await rows())[0].scannedAt).toEqual(first.scannedAt);

    expect(await (await put({ handle: "grace" })).json()).toEqual({ ok: true, linked: false });
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: first.id, url: "grace", scannedAt: null });
  });

  it("deletes the row when the link is cleared and no file is attached", async () => {
    await put({ handle: "ada", scan: true });
    expect(await (await put({ handle: "  " })).json()).toEqual({ ok: true });
    expect(await rows()).toEqual([]);
    // Clearing with nothing saved is fine too.
    expect((await put({ handle: "" })).status).toBe(200);
  });

  it("keeps an uploaded LinkedIn PDF when the link is cleared", async () => {
    await db
      .insert(schema.materials)
      .values({ userId: current!.id, kind: "linkedin", url: "ada", scannedAt: new Date(), fileKey: "uploads/ada.pdf", fileName: "Profile.pdf" });
    await put({ handle: "" });
    expect(await rows()).toEqual([expect.objectContaining({ url: null, scannedAt: null, fileKey: "uploads/ada.pdf", fileName: "Profile.pdf" })]);
  });

  it("refuses a handle over 100 characters", async () => {
    expect((await put({ handle: "x".repeat(101) })).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("only changes the signed-in person's link", async () => {
    const [other] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
    await db.insert(schema.materials).values({ userId: other.id, kind: "linkedin", url: "grace" });
    await put({ handle: "ada" });
    await put({ handle: "" });
    expect((await rows(other.id)).map((r) => r.url)).toEqual(["grace"]);
  });
});
