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
vi.mock("@/lib/apply", () => ({ canUseAutoApply: () => beta }));

const notes = await import("./route");
const answers = await import("../apply-answers/route");

const req = (url: string, data?: unknown) =>
  new Request(`https://lookout.test${url}`, data === undefined ? {} : { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
const profile = async () => (await db.select().from(schema.profiles).where(eq(schema.profiles.userId, current!.id)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  beta = true;
  await db.delete(schema.users);
  [current] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  await db.insert(schema.profiles).values({ userId: current.id });
});

describe("/api/profile/skill-notes (#121, #539)", () => {
  const get = () => notes.GET(req("/api/profile/skill-notes"), {});
  const put = (data: unknown) => notes.PUT(req("/api/profile/skill-notes", data), {});

  it("is not found unless auto-apply is on for the person", async () => {
    beta = false;
    expect((await get()).status).toBe(404);
    expect((await put({ skill: "Figma" })).status).toBe(404);
    expect((await profile()).skillNotes).toEqual([]);
  });

  it("adds, edits and forgets a note, matching the skill without regard to case", async () => {
    expect(await (await get()).json()).toEqual({ notes: [] });
    await put({ skill: "Design systems", story: "Built the token set for a bank app" });
    await put({ skill: "Accessibility" });
    await put({ skill: "design systems", story: "Led the token rollout" });
    const after = (await profile()).skillNotes;
    expect(after.map((n) => [n.skill, n.story])).toEqual([
      ["Accessibility", ""],
      ["design systems", "Led the token rollout"],
    ]);
    await put({ skill: "DESIGN SYSTEMS", forget: true });
    expect((await profile()).skillNotes.map((n) => n.skill)).toEqual(["Accessibility"]);
  });

  it("refuses an empty skill or an overlong story", async () => {
    expect((await put({ skill: "  " })).status).toBe(400);
    expect((await put({ skill: "Figma", story: "x".repeat(1501) })).status).toBe(400);
  });
});

describe("/api/profile/apply-answers (#108, #539)", () => {
  const get = () => answers.GET(req("/api/profile/apply-answers"), {});
  const put = (data: unknown) => answers.PUT(req("/api/profile/apply-answers", data), {});

  it("is not found unless auto-apply is on for the person", async () => {
    beta = false;
    expect((await get()).status).toBe(404);
    expect((await put({ question: "Zip code", answer: "11201" })).status).toBe(404);
  });

  it("saves, fixes, and forgets an answer when it is cleared", async () => {
    await put({ question: "What is your zip code?", answer: "11201" });
    await put({ question: "Are you authorized to work in the US?", answer: "Yes" });
    await put({ question: "What is your zip code?", answer: "11215" });
    expect((await (await get()).json()).answers.map((a: { question: string; answer: string }) => [a.question, a.answer])).toEqual([
      ["Are you authorized to work in the US?", "Yes"],
      ["What is your zip code?", "11215"],
    ]);
    await put({ question: "What is your zip code?", answer: "  " });
    expect((await profile()).applyAnswers.map((a) => a.question)).toEqual(["Are you authorized to work in the US?"]);
  });
});
