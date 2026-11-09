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
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let current: typeof schema.users.$inferSelect | null = null;
let beta = true;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => current, refreshSession: async () => {} }));
vi.mock("@/lib/apply", async (orig) => ({ ...(await orig<typeof import("@/lib/apply")>()), canUseAutoApply: () => beta }));

const { GET, PUT } = await import("./route");

const url = "https://lookout.test/api/profile/apply-answers";
const list = () => GET(new Request(url), {});
const save = (data: unknown) => PUT(new Request(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {});
const stored = async (userId: string) => (await db.select({ a: schema.profiles.applyAnswers }).from(schema.profiles).where(eq(schema.profiles.userId, userId)))[0].a;
const saved = (question: string, answer: string) => ({ key: question.toLowerCase(), question, answer, updatedAt: "2026-11-01T00:00:00.000Z" });

let other: typeof schema.users.$inferSelect;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  beta = true;
  await db.delete(schema.users);
  [current, other] = await db.insert(schema.users).values([{ email: "maya@example.com" }, { email: "other@example.com" }]).returning();
  await db.insert(schema.profiles).values([
    { userId: current.id, applyAnswers: [saved("Phone", "555-0100")] },
    { userId: other.id, applyAnswers: [saved("Phone", "555-0199")] },
  ]);
});

describe("GET /api/profile/apply-answers (#575)", () => {
  it("lists only your saved answers", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answers: [saved("Phone", "555-0100")] });
  });

  it("is an empty list when nothing is saved", async () => {
    await db.update(schema.profiles).set({ applyAnswers: [] }).where(eq(schema.profiles.userId, current!.id));
    expect(await (await list()).json()).toEqual({ answers: [] });
  });
});

describe("PUT /api/profile/apply-answers (#575)", () => {
  it("saves a new answer trimmed, keeps the list in question order, and leaves other people's alone", async () => {
    const res = await save({ question: "  Are you authorized to work in the US?  ", answer: " Yes " });
    expect(res.status).toBe(200);
    const { answers } = await res.json();
    expect(answers.map((a: { question: string; answer: string }) => [a.question, a.answer])).toEqual([
      ["Are you authorized to work in the US?", "Yes"],
      ["Phone", "555-0100"],
    ]);
    expect(await stored(current!.id)).toEqual(answers);
    expect(await stored(other.id)).toEqual([saved("Phone", "555-0199")]);
  });

  it("fixes an answer asked in nearly the same words instead of adding another", async () => {
    const { answers } = await (await save({ question: "Phone (mobile)!", answer: "555-0123" })).json();
    expect(answers).toEqual([expect.objectContaining({ key: "phone", question: "Phone (mobile)!", answer: "555-0123" })]);
    expect(await stored(current!.id)).toHaveLength(1);
  });

  it("forgets an answer when it's saved empty", async () => {
    expect(await (await save({ question: "phone", answer: "   " })).json()).toEqual({ answers: [] });
    expect(await stored(current!.id)).toEqual([]);
    expect(await stored(other.id)).toHaveLength(1);
  });

  it.each([
    {},
    { question: "Phone" },
    { question: "   ", answer: "x" },
    { question: "q".repeat(301), answer: "x" },
    { question: "Phone", answer: "a".repeat(301) },
  ])("refuses %j and changes nothing", async (data) => {
    expect((await save(data)).status).toBe(400);
    expect(await stored(current!.id)).toEqual([saved("Phone", "555-0100")]);
  });
});

describe("/api/profile/apply-answers gate (#575)", () => {
  it("is 404 outside the auto-apply beta, without reading or saving", async () => {
    beta = false;
    expect((await list()).status).toBe(404);
    expect((await save({ question: "Phone", answer: "" })).status).toBe(404);
    expect(await stored(current!.id)).toHaveLength(1);
  });

  it("needs a session", async () => {
    current = null;
    expect((await list()).status).toBe(401);
    expect((await save({ question: "Phone", answer: "1" })).status).toBe(401);
  });
});
