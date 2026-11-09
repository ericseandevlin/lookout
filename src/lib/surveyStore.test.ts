import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => ({ getSurveyConfig: async () => ({ everyDays: 5 }) }));

const ago = (d: number) => new Date(Date.now() - d * 864e5);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.surveyAnswers);
  await db.delete(schema.surveyQuestions);
  await db.delete(schema.users);
});

const user = async (email: string, joinedDaysAgo: number, name = "") => {
  const [u] = await db.insert(schema.users).values({ email, name, createdAt: ago(joinedDaysAgo) }).returning();
  return u;
};
const question = async (prompt: string, p: Partial<typeof schema.surveyQuestions.$inferInsert> = {}) => {
  const [q] = await db
    .insert(schema.surveyQuestions)
    .values({ kind: "text", prompt, ...p })
    .returning();
  return q;
};

describe("nextQuestion (#367)", () => {
  it("asks nothing in a new account's first N days, then the oldest active unanswered question", async () => {
    const { nextQuestion } = await import("./surveyStore");
    await question("Off", { active: false, createdAt: ago(30) });
    await question("First", { createdAt: ago(20) });
    await question("Second", { createdAt: ago(10) });

    expect(await nextQuestion(await user("new@example.com", 2))).toBeNull();
    const q = await nextQuestion(await user("old@example.com", 6));
    expect(q).toMatchObject({ prompt: "First", kind: "text", options: [] });
    expect(Object.keys(q!).sort()).toEqual(["id", "kind", "options", "prompt"]);
  });

  it("asks a question about the email only when the person's summary email is on (#514)", async () => {
    const { nextQuestion } = await import("./surveyStore");
    const q = await question("Do you read your Lookout new-matches email, use the site, or both?", { onlyIfDigest: true });
    const on = await user("on@x.com", 30);
    const off = await user("off@x.com", 30);
    const unset = await user("unset@x.com", 30);
    await db.insert(schema.settings).values([{ userId: on.id, digest: true }, { userId: off.id, digest: false }]);
    expect((await nextQuestion(on))?.id).toBe(q.id);
    expect(await nextQuestion(off)).toBeNull();
    expect((await nextQuestion(unset))?.id).toBe(q.id); // no settings row yet: the summary email is on by default
  });

  it("waits N days after an answer or a skip, then moves to the next question", async () => {
    const { nextQuestion } = await import("./surveyStore");
    const first = await question("First", { createdAt: ago(20) });
    await question("Second", { createdAt: ago(10) });
    const u = await user("pat@example.com", 30);

    await db.insert(schema.surveyAnswers).values({ questionId: first.id, userId: u.id, answer: null, createdAt: ago(1) });
    expect(await nextQuestion(u)).toBeNull();

    await db.update(schema.surveyAnswers).set({ createdAt: ago(5) });
    expect((await nextQuestion(u))?.prompt).toBe("Second");
  });

  it("returns null once every active question is answered", async () => {
    const { nextQuestion } = await import("./surveyStore");
    const q = await question("Only");
    const u = await user("pat@example.com", 30);
    await db.insert(schema.surveyAnswers).values({ questionId: q.id, userId: u.id, answer: "yes", createdAt: ago(9) });
    expect(await nextQuestion(u)).toBeNull();
  });
});

describe("answer (#367)", () => {
  it("stores the cleaned answer once and ignores a second reply", async () => {
    const { answer } = await import("./surveyStore");
    const q = await question("How useful?", { kind: "scale" });
    const u = await user("pat@example.com", 30);
    await answer(u.id, q.id, " 4 ");
    await answer(u.id, q.id, "1");
    expect(await db.select({ answer: schema.surveyAnswers.answer }).from(schema.surveyAnswers)).toEqual([{ answer: "4" }]);
  });

  it("records a skip as null", async () => {
    const { answer } = await import("./surveyStore");
    const q = await question("Anything else?");
    const u = await user("pat@example.com", 30);
    await answer(u.id, q.id, null);
    expect(await db.select({ answer: schema.surveyAnswers.answer }).from(schema.surveyAnswers)).toEqual([{ answer: null }]);
  });

  it("answers 404 for an inactive or unknown question and 400 for a bad answer", async () => {
    const { answer } = await import("./surveyStore");
    const off = await question("Off", { active: false });
    const pick = await question("Pick", { kind: "choice", options: ["Yes", "No"] });
    const u = await user("pat@example.com", 30);
    await expect(answer(u.id, off.id, "x")).rejects.toMatchObject({ status: 404 });
    await expect(answer(u.id, "00000000-0000-0000-0000-000000000000", "x")).rejects.toMatchObject({ status: 404 });
    await expect(answer(u.id, pick.id, "Maybe")).rejects.toMatchObject({ status: 400, message: "Pick one of the choices." });
    expect(await db.select().from(schema.surveyAnswers)).toHaveLength(0);
  });
});

describe("admin (#367)", () => {
  it("lists questions newest first with answers and skips counted apart", async () => {
    const { listQuestions } = await import("./surveyStore");
    const old = await question("Old", { createdAt: ago(10) });
    await question("New", { createdAt: ago(1) });
    const [a, b, c] = [await user("a@example.com", 30), await user("b@example.com", 30), await user("c@example.com", 30)];
    await db.insert(schema.surveyAnswers).values([
      { questionId: old.id, userId: a.id, answer: "yes" },
      { questionId: old.id, userId: b.id, answer: "no" },
      { questionId: old.id, userId: c.id, answer: null },
    ]);
    const list = await listQuestions();
    expect(list.map((q) => [q.prompt, q.answers, q.skipped])).toEqual([
      ["New", 0, 0],
      ["Old", 2, 1],
    ]);
    expect(typeof list[0].createdAt).toBe("string");
  });

  it("creates a question with cleaned options and rejects a choice question with one choice", async () => {
    const { createQuestion } = await import("./surveyStore");
    const q = await createQuestion({ kind: "choice", prompt: "  Which?  ", options: ["A", " A ", "", "B"] });
    expect(q).toMatchObject({ prompt: "Which?", options: ["A", "B"], active: true });
    await expect(createQuestion({ kind: "choice", prompt: "Which?", options: ["A"] })).rejects.toMatchObject({ status: 400 });
    expect((await createQuestion({ kind: "text", prompt: "Why?", options: ["ignored"] })).options).toEqual([]);
  });

  it("turns a question off and on, and answers 404 for an unknown id", async () => {
    const { setActive } = await import("./surveyStore");
    const q = await question("Q");
    await setActive(q.id, false);
    expect((await db.select().from(schema.surveyQuestions))[0].active).toBe(false);
    await setActive(q.id, true);
    expect((await db.select().from(schema.surveyQuestions))[0].active).toBe(true);
    await expect(setActive("00000000-0000-0000-0000-000000000000", false)).rejects.toMatchObject({ status: 404 });
  });

  it("lists one question's replies newest first with who answered", async () => {
    const { answersFor } = await import("./surveyStore");
    const q = await question("Q");
    const a = await user("a@example.com", 30, "Ann");
    const b = await user("b@example.com", 30);
    await db.insert(schema.surveyAnswers).values([
      { questionId: q.id, userId: a.id, answer: "first", createdAt: ago(2) },
      { questionId: q.id, userId: b.id, answer: null, createdAt: ago(1) },
    ]);
    const r = await answersFor(q.id);
    expect(r.question.prompt).toBe("Q");
    expect(r.rows.map((x) => [x.email, x.name, x.answer])).toEqual([
      ["b@example.com", "", null],
      ["a@example.com", "Ann", "first"],
    ]);
    await expect(answersFor("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 404 });
  });
});
