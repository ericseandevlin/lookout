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

const { closeGroupInvite, createGroupInvite, listGroupInvites, redeemGroupInvite } = await import("./groupInvite");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});

describe("group invites from Admin (#993)", () => {
  it("makes a link with the code asked for, and lists it as open", async () => {
    const r = await createGroupInvite({ code: "spin-class", label: "Spin class", max: 12, days: 7 });
    expect(r.ok).toBe(true);
    const [g] = await listGroupInvites();
    expect(g).toMatchObject({ code: "spin-class", label: "Spin class", max: 12, used: [], state: "open" });
    expect((new Date(g.expiresAt).getTime() - Date.now()) / 864e5).toBeCloseTo(7, 1);
  });

  it("refuses a code that's taken or malformed", async () => {
    expect(await createGroupInvite({ code: "spin-class", label: "Again", max: 1, days: 1 })).toMatchObject({ ok: false, status: 409 });
    expect(await createGroupInvite({ code: "No Spaces", label: "Bad", max: 1, days: 1 })).toMatchObject({ ok: false, status: 400 });
  });

  it("makes up a code when none is given, keeping earlier links", async () => {
    const r = await createGroupInvite({ label: "Meetup", max: 5, days: 3 });
    expect(r.ok && r.invite.code).toMatch(/^meetup-[a-z0-9]{4}$/);
    expect((await listGroupInvites()).map((g) => g.code).sort()).toEqual(["spin-class", r.ok ? r.invite.code : ""].sort());
  });

  it("works for sign-ups until closed, and closing keeps the people who joined", async () => {
    expect(await redeemGroupInvite("spin-class", "ana@x.co")).toEqual({ ok: true });
    expect(await closeGroupInvite("spin-class")).toBe(true);
    expect(await redeemGroupInvite("spin-class", "bo@x.co")).toEqual({ ok: false, why: "closed" });
    const g = (await listGroupInvites()).find((x) => x.code === "spin-class");
    expect(g).toMatchObject({ state: "closed", used: ["ana@x.co"] });
    expect(await db.select().from(schema.invites).where(eq(schema.invites.email, "ana@x.co"))).toHaveLength(1);
  });

  it("says when there's no such link to close", async () => expect(await closeGroupInvite("nope-nope")).toBe(false));
});
