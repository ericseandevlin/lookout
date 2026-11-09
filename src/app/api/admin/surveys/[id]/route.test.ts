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
  process.env.ADMIN_EMAILS = "";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
type User = typeof schema.users.$inferSelect;
let me: User | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));

const { GET, PATCH } = await import("./route");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, query = "") => GET(new Request(`https://lookout.test/api/admin/surveys/${id}${query}`), ctx(id));
const patch = (id: string, data: unknown) =>
  PATCH(new Request(`https://lookout.test/api/admin/surveys/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), ctx(id));
const user = async (email: string, isAdmin = false) => (await db.insert(schema.users).values({ email, isAdmin }).returning())[0];
const question = async () => (await db.select().from(schema.surveyQuestions).where(eq(schema.surveyQuestions.id, qid)))[0];

let admin: User, bob: User, qid: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.surveyQuestions);
  await db.delete(schema.users);
  admin = await user("admin@example.com", true);
  bob = await user("bob@example.com");
  const [q] = await db.insert(schema.surveyQuestions).values({ kind: "choice", prompt: "Did you get an interview?", options: ["Yes", "No"] }).returning();
  qid = q.id;
  await db.insert(schema.surveyAnswers).values({ questionId: qid, userId: bob.id, answer: "Yes" });
  me = admin;
});

describe("GET /api/admin/surveys/[id] (#537)", () => {
  it("needs a session, then an admin", async () => {
    me = null;
    expect((await get(qid)).status).toBe(401);
    me = bob;
    expect((await get(qid)).status).toBe(403);
  });

  it("is a 404 for a malformed or unknown id", async () => {
    expect((await get("not-a-uuid")).status).toBe(404);
    expect((await get("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("lists the answers with who and when", async () => {
    const { rows } = await (await get(qid)).json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "bob@example.com", answer: "Yes" });
    expect(new Date(rows[0].at).toString()).not.toBe("Invalid Date");
  });

  it("downloads the answers as CSV with ?format=csv, never cached", async () => {
    const res = await get(qid, "?format=csv");
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="survey-${qid.slice(0, 8)}.csv"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).toContain("bob@example.com");
    expect(text).toContain("Yes");
  });
});

describe("PATCH /api/admin/surveys/[id] (#537)", () => {
  it("is admin only", async () => {
    me = bob;
    expect((await patch(qid, { active: false })).status).toBe(403);
    expect((await question()).active).toBe(true);
  });

  it("turns a question off and on", async () => {
    expect((await patch(qid, { active: false })).status).toBe(200);
    expect((await question()).active).toBe(false);
    await patch(qid, { active: true });
    expect((await question()).active).toBe(true);
  });

  it("sets and clears what the question counts as in Admin > Metrics (#526)", async () => {
    expect((await patch(qid, { outcome: "interview", outcomeAnswer: "Yes" })).status).toBe(200);
    expect(await question()).toMatchObject({ outcome: "interview", outcomeAnswer: "Yes" });
    await patch(qid, { outcome: null });
    expect(await question()).toMatchObject({ outcome: null, outcomeAnswer: null });
  });

  it("refuses a body that is neither shape, and a malformed id", async () => {
    expect((await patch(qid, { outcome: "promotion" })).status).toBe(400);
    expect((await patch("nope", { active: false })).status).toBe(404);
  });
});
