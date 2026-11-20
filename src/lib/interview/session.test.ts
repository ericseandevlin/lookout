import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { InterviewTurnOut } from "./interviewer";

// The interview (#1449) on an in-process Postgres with the real migrations. Every model call is stubbed.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

type Call = { name: string; user: string; usage: { usd: number } };
let replies: InterviewTurnOut[] = [];
const completeJSON = vi.fn(async (c: Call) => {
  c.usage.usd += 0.001;
  const r = replies.shift();
  if (!r) throw new Error("No stub left");
  return r;
});
vi.mock("@/lib/ai/llm", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/llm")>()), completeJSON }));
vi.mock("@/lib/ai/runs", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/runs")>()), assertBudget: async () => {} }));

const { act, openInterview } = await import("./session");
const { LOCK } = await import("./rules");

const ALL_ANSWERS: schema.ProfileAnswers = { q1: "Director of Events", floor: "140000", target: "180000", modes: ["Hybrid"], area: "New York", q4: "Grew revenue 38%", q5: "No relocation" };
const ask = (topic: string, question = `Tell me about ${topic}.`, type: InterviewTurnOut["next"]["type"] = "new_topic"): InterviewTurnOut => ({ facts: [], next: { type, topic, question, why: "Asked by 3 of your top 5 finds." } });

let seq = 0;
async function seedUser(answers: schema.ProfileAnswers) {
  const [user] = await db.insert(schema.users).values({ email: `maya${++seq}@example.com`, name: "Maya Ortiz" }).returning();
  const [search] = await db.insert(schema.searches).values({ userId: user.id, name: "Job search", kind: "job", answers }).returning();
  await db.insert(schema.profiles).values({ userId: user.id });
  const [opp] = await db.insert(schema.opportunities).values({ company: "Harbor Hall", title: "Director of Events", fingerprint: `fp-${seq}`, description: "Runs F&B programs." }).returning();
  await db.insert(schema.userOpportunities).values({ userId: user.id, searchId: search.id, opportunityId: opp.id, score: 5, reasonsGap: ["F&B program experience"] });
  return { user, search };
}
const turns = (userId: string) => db.select().from(schema.interviewTurns).where(eq(schema.interviewTurns.userId, userId)).orderBy(schema.interviewTurns.createdAt);
const facts = (userId: string) => db.select().from(schema.profileFacts).where(eq(schema.profileFacts.userId, userId));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_INTERVIEW = "on";
  await db.delete(schema.users);
  await db.delete(schema.opportunities);
  replies = [];
  completeJSON.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("setup questions as the first turns (#1449)", () => {
  it("asks the missing setup questions first, saves an answer onto the search, and never asks a skipped one again", async () => {
    const { user, search } = await seedUser({ q4: "Grew revenue 38%" });
    let v = await openInterview(user.id);
    expect(v.current?.setup).toBe(true);
    expect(v.current?.question).toMatch(/next role/);

    await act(user.id, v.current!.id, "answer", "Director of Events at a flagship venue");
    const [s] = await db.select().from(schema.searches).where(eq(schema.searches.id, search.id));
    expect(s.answers.q1).toBe("Director of Events at a flagship venue");

    v = await openInterview(user.id);
    expect(v.current?.question).toMatch(/comp/i);
    await act(user.id, v.current!.id, "skip");
    v = await openInterview(user.id);
    expect(v.current?.question).toMatch(/Where and how/);
    await act(user.id, v.current!.id, "not_applicable");

    // q4 was answered on the Questions page; q5 is next. Then the setup is done and the model asks.
    v = await openInterview(user.id);
    expect(v.current?.question).toMatch(/off the table/);
    replies = [ask("food and beverage programs")];
    await act(user.id, v.current!.id, "answer", "No relocation");
    v = await openInterview(user.id);
    expect(v.current?.setup).toBe(false);

    const rows = await turns(user.id);
    expect(rows.find((t) => t.setupKey === "comp")?.outcome).toBe("skipped");
    expect(rows.find((t) => t.setupKey === "where")?.outcome).toBe("not_applicable");
    // Each setup question was asked once, whatever happened to it.
    expect(rows.filter((t) => t.setupKey === "comp")).toHaveLength(1);
    expect(rows.filter((t) => t.setupKey === "where")).toHaveLength(1);
  });

  it("copies existing setup answers in as facts once, pay always private, and not again after a delete", async () => {
    const { user } = await seedUser(ALL_ANSWERS);
    replies = [ask("food and beverage programs")];
    await openInterview(user.id);
    const list = await facts(user.id);
    expect(list.map((f) => f.setupKey).sort()).toEqual(["comp", "q1", "q4", "q5", "where"]);
    const pay = list.find((f) => f.kind === "pay")!;
    expect(pay).toMatchObject({ shareable: false, lockReason: LOCK.pay });
    await db.delete(schema.profileFacts).where(eq(schema.profileFacts.id, list[0].id));
    await openInterview(user.id);
    expect(await facts(user.id)).toHaveLength(4);
  });
});

describe("gap questions (#1449)", () => {
  it("stores Skip and Doesn't apply and never asks those topics again, even when the model picks them", async () => {
    const { user } = await seedUser(ALL_ANSWERS);
    replies = [ask("stakeholder management")];
    let v = await openInterview(user.id);
    expect(v.current?.question).toBe("Tell me about stakeholder management.");

    // The model tries the skipped topic again, spelled differently; code refuses it and asks once more.
    replies = [ask("Stakeholder  Management"), ask("event CRM")];
    await act(user.id, v.current!.id, "skip");
    v = await openInterview(user.id);
    expect(v.current?.question).toBe("Tell me about event CRM.");
    const retry = completeJSON.mock.calls.at(-1)![0];
    expect(retry.user).toContain("Never ask again: stakeholder management");
    expect(retry.user).toContain('You picked "Stakeholder  Management"');

    // Doesn't apply closes a topic the same way; a refused retry ends the interview for now.
    replies = [ask("event crm"), ask("Event CRM")];
    await act(user.id, v.current!.id, "not_applicable");
    v = await openInterview(user.id);
    expect(v.current).toBeNull();

    const rows = await turns(user.id);
    expect(rows.filter((t) => !t.setupKey).map((t) => [t.topic, t.outcome])).toEqual([
      ["stakeholder management", "skipped"],
      ["event CRM", "not_applicable"],
    ]);
  });

  it("saves facts in the person's words, keeps a named person or complaint private, and follows up on the same topic", async () => {
    const { user } = await seedUser(ALL_ANSWERS);
    replies = [ask("food and beverage programs")];
    const v = await openInterview(user.id);
    replies = [
      {
        facts: [
          { text: "Ran a 12-dinner touring supper series", kind: "project", namesPerson: false, complaint: false, confidential: false, personal: false },
          { text: "My manager was skeptical of the series at first", kind: "background", namesPerson: true, complaint: true, confidential: false, personal: false },
        ],
        next: { type: "follow_up", topic: "food and beverage programs", question: "What was your exact part?", why: "Recruiters ask for your part." },
      },
    ];
    const after = await act(user.id, v.current!.id, "answer", "I ran our touring supper series. Dana, my boss, hated the idea at first.");
    expect(after.note).toBeNull();
    const list = await facts(user.id);
    const series = list.find((f) => f.text.startsWith("Ran a 12-dinner"))!;
    const boss = list.find((f) => f.text.startsWith("My manager"))!;
    expect(series).toMatchObject({ source: "interview", shareable: true, lockReason: null, turnId: v.current!.id });
    expect(boss).toMatchObject({ shareable: false, lockReason: LOCK.complaint });
    expect(series.quote).toContain("touring supper series");
    const rows = await turns(user.id);
    expect(rows.at(-1)).toMatchObject({ question: "What was your exact part?", parentId: v.current!.id, outcome: "pending" });
  });

  it("never sends pay to the interviewer", async () => {
    const { user } = await seedUser(ALL_ANSWERS);
    replies = [ask("food and beverage programs")];
    await openInterview(user.id);
    const prompt = completeJSON.mock.calls[0][0].user;
    expect(prompt).not.toContain("140");
    expect(prompt).not.toContain("180");
    expect(prompt).toContain("Harbor Hall");
  });

  it("keeps the answer when the model fails, and says so", async () => {
    const { user } = await seedUser(ALL_ANSWERS);
    replies = [ask("food and beverage programs")];
    const v = await openInterview(user.id);
    const r = await act(user.id, v.current!.id, "answer", "Yes, for three years.");
    expect(r.note).toMatch(/Your answer is saved/);
    expect((await turns(user.id)).find((t) => t.id === v.current!.id)).toMatchObject({ outcome: "answered", answer: "Yes, for three years." });
  });
});
