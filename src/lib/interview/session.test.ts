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

const { act, earlierTurns, interviewView, openInterview, EARLIER_PAGE, SITTING_GAP_MS } = await import("./session");
const { FACTS_IN_PROMPT, TOPICS_IN_PROMPT } = await import("./interviewer");
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

    // The follow-up's answer: the model repeats an earlier fact (differently cased); only the new one is saved.
    replies = [
      {
        facts: [
          { text: "ran a 12-dinner touring supper series.", kind: "project", namesPerson: false, complaint: false, confidential: false, personal: false },
          { text: "Owned a budget of about $240k", kind: "skill", namesPerson: false, complaint: false, confidential: false, personal: false },
        ],
        next: { type: "follow_up", topic: "food and beverage programs", question: "How many covers?", why: "A number helps." },
      },
    ];
    await act(user.id, rows.at(-1)!.id, "answer", "I led it and owned the budget, about $240k.");
    expect((await facts(user.id)).filter((f) => f.source === "interview").map((f) => f.text).sort()).toEqual([
      "My manager was skeptical of the series at first",
      "Owned a budget of about $240k",
      "Ran a 12-dinner touring supper series",
    ]);
    const prompt = completeJSON.mock.calls.at(-1)![0].user;
    expect(prompt).toContain("A (facts already saved): I ran our touring supper series.");
    expect(prompt).toContain("A (newest: read this one): I led it and owned the budget");
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

/** A long history, written straight to the tables: `n` topics (every other one skipped), `per` facts per answer, `daysAgo` days back. */
async function seedHistory(userId: string, n: number, per: number, daysAgo: number) {
  const base = Date.now() - daysAgo * 86_400_000;
  for (let i = 0; i < n; i++) {
    const at = new Date(base + i * 60_000);
    const pad = String(i).padStart(4, "0");
    const outcome: schema.TurnOutcome = i % 2 === 0 ? "skipped" : "answered";
    const [t] = await db
      .insert(schema.interviewTurns)
      .values({ userId, topic: `topic ${pad}`, question: `Question ${pad}?`, outcome, answer: outcome === "answered" ? `Answer ${pad}.` : null, createdAt: at, answeredAt: at })
      .returning();
    if (per && outcome === "answered")
      await db.insert(schema.profileFacts).values(Array.from({ length: per }, (_, k) => ({ userId, text: `Fact ${pad}-${k}`, kind: "result" as const, source: "interview" as const, turnId: t.id, createdAt: at })));
  }
}

describe("a long interview (#1449)", () => {
  it("sends the model the same size prompt at answer 100 as at answer 200: newest facts and topics only, this topic's turns only", async () => {
    const prompts: string[] = [];
    for (const n of [120, 240]) {
      const { user } = await seedUser(ALL_ANSWERS);
      await seedHistory(user.id, n, 1, 3);
      // The newest topic, open now, with one follow-up answered.
      replies = [ask("event CRM")];
      let v = await openInterview(user.id);
      replies = [{ facts: [], next: { type: "follow_up", topic: "event CRM", question: "Which tool?", why: "A name helps." } }];
      await act(user.id, v.current!.id, "answer", "I ran the CRM for 3 venues.");
      v = await interviewView(user.id);
      replies = [ask("topic 0000")];
      replies.push(ask("vendor contracts"));
      await act(user.id, v.current!.id, "answer", "Salesforce.");
      const calls = completeJSON.mock.calls.slice(-2).map((c) => c[0].user);
      prompts.push(calls[0]);
      // topic 0000 was skipped long ago and is past the prompt's cap, but code still refuses it.
      expect(calls[1]).toContain('You picked "topic 0000"');
    }
    const [a, b] = prompts;
    expect(b.length).toBe(a.length);
    const facts = b.slice(b.indexOf("<known_facts>"), b.indexOf("</known_facts>")).split("\n").filter((l) => l.startsWith("- "));
    expect(facts).toHaveLength(FACTS_IN_PROMPT);
    expect(b).toContain("Fact 0239-0");
    expect(b).not.toContain("Fact 0001-0");
    const covered = b.match(/Topics already covered: (.*)/)![1].split("; ");
    expect(covered.length).toBeLessThanOrEqual(TOPICS_IN_PROMPT);
    // The thread is this topic only: two questions, no older answers.
    expect(b).toContain("A (facts already saved): I ran the CRM for 3 venues.");
    expect(b).toContain("A (newest: read this one): Salesforce.");
    expect(b).not.toContain("Answer 0239.");
  });

  it("shows only this sitting and pages Earlier answers 20 at a time, with each page's facts", async () => {
    const { user } = await seedUser(ALL_ANSWERS);
    await seedHistory(user.id, 45, 2, 3);
    replies = [ask("event CRM")];
    let v = await openInterview(user.id);
    expect(v.turns).toHaveLength(0);
    expect(v.earlier).toBe(45);
    replies = [ask("vendor contracts")];
    await act(user.id, v.current!.id, "answer", "Yes.");
    v = await interviewView(user.id);
    expect(v.turns.map((t) => t.question)).toEqual(["Tell me about event CRM."]);
    expect(v.earlier).toBe(45);

    const seen: string[] = [];
    let before = v.earlierBefore;
    for (const want of [EARLIER_PAGE, EARLIER_PAGE, 5]) {
      const page = await earlierTurns(user.id, before);
      expect(page.turns).toHaveLength(want);
      expect(page.more).toBe(want === EARLIER_PAGE);
      seen.unshift(...page.turns.map((t) => t.question));
      before = page.turns[0].id;
      const answered = page.turns.find((t) => t.outcome === "answered")!;
      expect(answered.facts).toHaveLength(2);
    }
    expect(seen).toEqual(Array.from({ length: 45 }, (_, i) => `Question ${String(i).padStart(4, "0")}?`));
    expect(SITTING_GAP_MS).toBe(2 * 60 * 60_000);
  });

  it("offers a good place to stop after 5 topics in a sitting, only before a new topic, with the sitting's real fact count", async () => {
    const { user } = await seedUser(ALL_ANSWERS);
    await seedHistory(user.id, 4, 2, 0.01);
    replies = [ask("event CRM")];
    let v = await openInterview(user.id);
    expect(v.sitting.topics).toBe(4);
    expect(v.softStop).toBe(false);
    replies = [{ facts: [], next: { type: "follow_up", topic: "event CRM", question: "Which tool?", why: "A name helps." } }];
    await act(user.id, v.current!.id, "answer", "Yes.");
    v = await interviewView(user.id);
    // Five topics, but the waiting question is a follow-up: no stop in the middle of a topic.
    expect(v.sitting.topics).toBe(5);
    expect(v.softStop).toBe(false);
    replies = [ask("vendor contracts")];
    await act(user.id, v.current!.id, "answer", "Salesforce.");
    v = await interviewView(user.id);
    expect(v.softStop).toBe(true);
    // Of the 4 seeded topics, 2 were answered with 2 facts each.
    expect(v.sitting.facts).toBe(4);
  });
});
