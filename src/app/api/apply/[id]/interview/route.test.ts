import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// The keyword interview on the review page (#1485), on an in-process Postgres with the real migrations.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
  process.env.ADMIN_EMAILS = "";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let me: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: async () => true }));
type Call = { name: string; user: string; usage: { usd: number } };
let replies: unknown[] = [];
const completeJSON = vi.fn(async (c: Call) => {
  c.usage.usd += 0.001;
  if (!replies.length) throw new Error("No stub left");
  return replies.shift();
});
vi.mock("@/lib/ai/llm", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/llm")>()), completeJSON }));
vi.mock("@/lib/ai/runs", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/runs")>()), assertBudget: async () => {} }));

const { POST } = await import("./route");

type User = typeof schema.users.$inferSelect;
type Row = { term: string; support: { line: string; from: string } | null; removed: boolean; mine: boolean };
type Q = { id: string; terms: string[]; question: string; why: string };
type Out = { questions: Q[]; rows: Row[]; result?: { saved: number; private: number; backed: string[]; note: string | null } };
let alice: User;
let appId: string;

const send = async (data: unknown) => {
  const res = await POST(new Request(`https://lookout.test/api/apply/${appId}/interview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {
    params: Promise.resolve({ id: appId }),
  });
  return { status: res.status, body: (res.status === 200 ? await res.json() : null) as Out };
};
const missing = (o: Out) => o.rows.filter((r) => !r.removed && !r.support).map((r) => r.term);
const backed = (o: Out) => o.rows.filter((r) => !r.removed && r.support).map((r) => r.term);
const fact = (text: string, flags: Partial<Record<"namesPerson" | "complaint" | "confidential" | "personal", boolean>> = {}) => ({ text, kind: "result", namesPerson: false, complaint: false, confidential: false, personal: false, ...flags });
const groups = {
  questions: [
    { terms: ["managing managers", "Global Design Team"], question: "Have you managed managers on a global design team? How many people?", why: "The posting asks for both, and nothing in your resume shows it." },
    { terms: ["Figma", "something not on the list"], question: "Tell me about Figma.", why: "It is in the posting." },
  ],
};
const POSTING = "Lead a global design team across three regions. You will be managing managers. Must have Kubernetes experience. Daily work in Figma. Strong tools and craft.";

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_AUTO_APPLY = "on";
  process.env.FEATURE_INTERVIEW = "on";
  replies = [];
  completeJSON.mockClear();
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  [alice] = await db.insert(schema.users).values({ email: "alice@example.com", isAdmin: true }).returning();
  me = alice;
  await db.insert(schema.profiles).values({ userId: alice.id });
  // Her resume backs Figma only.
  await db.insert(schema.materials).values({ userId: alice.id, kind: "resume", extracted: { text: "Built the Figma component library for a design system" } });
  const [o] = await db.insert(schema.opportunities).values({ type: "job", company: "Acme", title: "Design Director", fingerprint: crypto.randomUUID() }).returning();
  const keywordPlan = [{ term: "Figma" }, { term: "managing managers" }, { term: "global design team" }, { term: "Kubernetes" }, { term: "tools" }, { term: "craft" }];
  [{ id: appId }] = await db.insert(schema.applications).values({ userId: alice.id, opportunityId: o.id, status: "needs_review", report: { postingText: POSTING, keywordPlan } }).returning();
});

describe("POST /api/apply/[id]/interview (#1485)", () => {
  it("is 404 with the interview flag off", async () => {
    process.env.FEATURE_INTERVIEW = "off";
    expect((await send({ action: "questions" })).status).toBe(404);
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it("groups the missing keywords into questions, related keywords in one, once", async () => {
    replies = [groups];
    const { status, body } = await send({ action: "questions" });
    expect(status).toBe(200);
    // Generic single words are gone; Figma is backed by the resume, so it is not asked.
    expect(body.rows.map((r) => r.term)).toEqual(["Figma", "managing managers", "global design team", "Kubernetes"]);
    expect(completeJSON.mock.calls[0][0].user).toContain("- managing managers");
    expect(completeJSON.mock.calls[0][0].user).not.toContain("- Figma");
    expect(body.questions).toEqual([
      { id: "q1", terms: ["managing managers", "global design team"], question: "Have you managed managers on a global design team? How many people?", why: "The posting asks for both." },
      // Left out by the model, so it gets a question of its own.
      { id: "q2", terms: ["Kubernetes"], question: "Have you done Kubernetes? Tell me where, your part, and a number if you have one.", why: "The posting asks for Kubernetes." },
    ]);
    // Stored on the application: the next open costs no model call.
    expect((await send({ action: "questions" })).body.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(completeJSON).toHaveBeenCalledTimes(1);
  });

  it("an answer saves facts the normal way and moves the keywords it backs to In your resume", async () => {
    replies = [groups];
    await send({ action: "questions" });
    replies = [{ facts: [fact("Managed 3 design managers across a 40-person global design team")], backs: ["Managing managers", "global design team", "Kubernetes"] }];
    const { body } = await send({ action: "answer", question: "q1", text: "I ran a 40 person design team in 3 regions, with 3 managers under me." });
    expect(body.result).toEqual({ saved: 1, private: 0, backed: ["managing managers", "global design team"], note: null });
    // Kubernetes wasn't in this question, so the answer can't back it.
    expect(backed(body)).toEqual(["Figma", "managing managers", "global design team"]);
    expect(missing(body)).toEqual(["Kubernetes"]);
    expect(body.questions.map((q) => q.id)).toEqual(["q2"]);

    const [turn] = await db.select().from(schema.interviewTurns).where(eq(schema.interviewTurns.userId, alice.id));
    expect(turn).toMatchObject({ topic: "managing managers, global design team", outcome: "answered", answer: "I ran a 40 person design team in 3 regions, with 3 managers under me." });
    const facts = await db.select().from(schema.profileFacts).where(eq(schema.profileFacts.userId, alice.id));
    expect(facts).toMatchObject([{ text: "Managed 3 design managers across a 40-person global design team", turnId: turn.id, source: "interview", shareable: true }]);
    const [prof] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, alice.id));
    expect(prof.skillNotes.map((n) => n.skill).sort()).toEqual(["global design team", "managing managers"]);
    // A second press on the same question saves nothing more.
    expect((await send({ action: "answer", question: "q1", text: "again" })).status).toBe(409);
  });

  it("Skip adds nothing and the keyword stays missing", async () => {
    replies = [groups];
    await send({ action: "questions" });
    const { body } = await send({ action: "skip", question: "q2" });
    expect(completeJSON).toHaveBeenCalledTimes(1);
    expect(body.result).toEqual({ saved: 0, private: 0, backed: [], note: null });
    expect(missing(body)).toContain("Kubernetes");
    expect(body.questions.map((q) => q.id)).toEqual(["q1"]);
    expect(await db.select().from(schema.profileFacts).where(eq(schema.profileFacts.userId, alice.id))).toHaveLength(0);
    const [turn] = await db.select().from(schema.interviewTurns).where(eq(schema.interviewTurns.userId, alice.id));
    expect(turn).toMatchObject({ topic: "Kubernetes", outcome: "skipped", answer: null });
  });

  it("a private fact is saved but backs nothing", async () => {
    replies = [groups];
    await send({ action: "questions" });
    replies = [{ facts: [fact("Managed managers while my father was ill", { personal: true })], backs: ["managing managers"] }];
    const { body } = await send({ action: "answer", question: "q1", text: "I managed managers while caring for my dad." });
    expect(body.result).toMatchObject({ saved: 1, private: 1, backed: [] });
    expect(missing(body)).toContain("managing managers");
  });

  it("a keyword the person adds by hand gets its own question", async () => {
    replies = [groups];
    await send({ action: "questions" });
    const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, appId));
    await db.update(schema.applications).set({ report: { ...a.report, keywordChoices: { include: ["event CRM"], exclude: [] } } }).where(eq(schema.applications.id, appId));
    replies = [{ questions: [{ terms: ["event CRM"], question: "Have you run an event CRM?", why: "You added it." }] }];
    const { body } = await send({ action: "questions" });
    expect(completeJSON.mock.calls[1][0].user).toContain("- event CRM");
    expect(body.questions.map((q) => [q.id, q.terms])).toEqual([
      ["q1", ["managing managers", "global design team"]],
      ["q2", ["Kubernetes"]],
      ["q3", ["event CRM"]],
    ]);
  });

  it("backing a starred keyword never lets a different keyword into the capped list", async () => {
    // 14 keywords, more than the cap. Three are asked for three times each, so they are starred. "zoning" is asked for
    // twice and sits last, so it is the next in line; backing a starred one must not let it in.
    const terms = ["event sales", "budgets", "catering", ...Array.from({ length: 10 }, (_, i) => `skill${i}`), "zoning"];
    const thrice = (t: string) => `Own ${t}. Must have ${t}. Grow ${t}.`;
    const posting = `${thrice("event sales")} ${thrice("budgets")} ${thrice("catering")} ${terms.slice(3, 13).join(". ")}. Know zoning. More zoning.`;
    const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, appId));
    await db.update(schema.applications).set({ report: { ...a.report, postingText: posting, keywordPlan: terms.map((term) => ({ term })) } }).where(eq(schema.applications.id, appId));
    replies = [{ questions: [{ terms: ["event sales"], question: "Have you owned event sales?", why: "Asked three times." }] }];
    const before = (await send({ action: "questions" })).body;
    expect(before.rows).toHaveLength(12);
    expect(before.rows.map((r) => r.term)).toContain("event sales");
    expect(before.rows.map((r) => r.term)).not.toContain("zoning");
    replies = [{ facts: [fact("Owned event sales for a 1,200-person venue")], backs: ["event sales"] }];
    const after = (await send({ action: "answer", question: "q1", text: "I owned event sales." })).body;
    expect(backed(after)).toContain("event sales");
    expect(after.rows.map((r) => r.term)).toEqual(before.rows.map((r) => r.term));
  });
});
