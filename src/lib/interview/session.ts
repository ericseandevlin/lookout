import "server-only";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { AiConfigError, completeJSON, emptyUsage, type Usage } from "@/lib/ai/llm";
import { assertBudget, BudgetError } from "@/lib/ai/runs";
import { traceAs } from "@/lib/ai/trace";
import { HttpError } from "@/lib/api";
import { masterForDrafts } from "@/lib/application/masterCheck";
import { kindOf } from "@/lib/kinds";
import { getActiveSearch } from "@/lib/searches";
import type { FactKind, TurnOutcome } from "@/lib/db/schema";
import { closedTopics, INTERVIEW_SYSTEM, interviewPrompt, InterviewTurnOut, type InterviewInput } from "./interviewer";
import { lockReason, topicKey } from "./rules";
import { isAnswered, readSetupAnswer, setupFact, setupQuestionText, SETUP_WHY } from "./setup";

/**
 * The interview's flow (#1449): one pending question at a time. The first turns are the setup questions the search
 * still lacks; after that, each question comes from a gap in the person's top finds. Skip and Doesn't apply close a
 * topic for good.
 */

type Turn = typeof schema.interviewTurns.$inferSelect;

/** Follow-ups after the first question on a topic: enough for the person's part, the scope and a number. */
export const MAX_FOLLOW_UPS = 2;
/** The finds a question can come from: the 5 highest-match finds not marked Nope or Not a fit. */
export const TOP_FINDS = 5;

export const DONE_NOTE = "That's every gap Lookout sees for now. It asks again when new finds come in.";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function turnsOf(userId: string) {
  return db.select().from(schema.interviewTurns).where(eq(schema.interviewTurns.userId, userId)).orderBy(asc(schema.interviewTurns.createdAt));
}

async function addFact(userId: string, f: { text: string; kind: FactKind; source: "interview" | "setup"; quote: string; turnId: string; setupKey?: string; flags?: Parameters<typeof lockReason>[2] }) {
  const reason = lockReason(f.text, f.kind, f.flags);
  await db.insert(schema.profileFacts).values({
    userId,
    text: f.text.slice(0, 1000),
    kind: f.kind,
    source: f.source,
    quote: f.quote.slice(0, 2000),
    turnId: f.turnId,
    setupKey: f.setupKey ?? null,
    shareable: !reason,
    lockReason: reason,
  });
}

/**
 * Setup answers already on the search become facts the first time the interview or What Lookout knows opens, once,
 * so a fact the person deletes isn't copied back.
 */
export async function importSetupFacts(userId: string) {
  const [p] = await db.select({ at: schema.profiles.factsImportedAt }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  if (p?.at) return;
  const search = await getActiveSearch(userId);
  if (search) {
    const cfg = kindOf(search.kind);
    const rows = cfg.questions.flatMap((q) => {
      const f = setupFact(q, search.answers);
      if (!f) return [];
      const reason = lockReason(f.text, f.kind);
      return [{ userId, text: f.text, kind: f.kind, source: "setup" as const, setupKey: q.key, shareable: !reason, lockReason: reason }];
    });
    if (rows.length) await db.insert(schema.profileFacts).values(rows);
  }
  if (p) await db.update(schema.profiles).set({ factsImportedAt: new Date() }).where(eq(schema.profiles.userId, userId));
  else await db.insert(schema.profiles).values({ userId, factsImportedAt: new Date() }).onConflictDoUpdate({ target: schema.profiles.userId, set: { factsImportedAt: new Date() } });
}

/** Everything the interviewer reads. Pay is never in it: not the setup answer, not a pay fact. */
async function context(userId: string): Promise<Omit<InterviewInput, "followUpsLeft">> {
  const search = await getActiveSearch(userId);
  const a = search?.answers ?? {};
  const modes = Array.isArray(a.modes) ? a.modes.join(", ") : "";
  const profile = [
    str(a.q1) && `Next role they want: ${str(a.q1)}`,
    (modes || str(a.area)) && `Where: ${[modes, str(a.area)].filter(Boolean).join("; ")}`,
    str(a.q4) && `Win they lead with: ${str(a.q4)}`,
    str(a.q5) && `Off the table: ${str(a.q5)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const [prof] = await db.select({ m: schema.profiles.masterResume }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const [mat] = await db.select({ x: schema.materials.extracted }).from(schema.materials).where(and(eq(schema.materials.userId, userId), eq(schema.materials.kind, "resume")));
  // A resume read before the full text was kept has only its summary; that still tells the interviewer something.
  const resume = masterForDrafts(prof?.m) ?? mat?.x?.text ?? mat?.x?.summary ?? "";
  const finds = search
    ? await db
        .select({ company: schema.opportunities.company, title: schema.opportunities.title, gaps: schema.userOpportunities.reasonsGap, matches: schema.userOpportunities.reasonsMatch, text: schema.opportunities.description })
        .from(schema.userOpportunities)
        .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
        .where(and(eq(schema.userOpportunities.searchId, search.id), eq(schema.userOpportunities.archived, false), ne(schema.userOpportunities.stage, "Nope"), isNull(schema.userOpportunities.feedback)))
        .orderBy(desc(schema.userOpportunities.score), desc(schema.userOpportunities.addedAt))
        .limit(TOP_FINDS)
    : [];
  const facts = await db
    .select({ text: schema.profileFacts.text, shareable: schema.profileFacts.shareable })
    .from(schema.profileFacts)
    .where(and(eq(schema.profileFacts.userId, userId), ne(schema.profileFacts.kind, "pay")))
    .orderBy(asc(schema.profileFacts.createdAt));
  const past = (await turnsOf(userId)).filter((t) => !t.setupKey && t.outcome !== "pending").map((t) => ({ topic: t.topic, outcome: t.outcome }));
  return { profile, resume, finds, facts, past };
}

/** The next setup question the search lacks and the interview hasn't asked yet. */
async function nextSetup(userId: string, turns: Turn[]) {
  const search = await getActiveSearch(userId);
  if (!search) return null;
  const cfg = kindOf(search.kind);
  return cfg.questions.find((q) => !isAnswered(cfg, q, search.answers) && !turns.some((t) => t.setupKey === q.key)) ?? null;
}

const addUsd = (u: Usage) => (u.usd ? u.usd.toFixed(4) : undefined);

/**
 * One interviewer step: read the last answer (if any) for facts, then pick the next question. A topic that was
 * skipped, that doesn't apply, or (for a new topic) that was already covered is refused in code and asked for once more.
 */
async function interviewStep(userId: string, answered: { turn: Turn; root: Turn; thread: { question: string; answer: string | null }[] } | null) {
  await assertBudget(userId);
  traceAs("interview", userId, answered?.root.id ?? userId);
  const ctx = await context(userId);
  const usage = emptyUsage();
  const followUpsLeft = answered ? Math.max(0, MAX_FOLLOW_UPS - (answered.thread.length - 1)) : 0;
  const closed = closedTopics(ctx.past);
  const covered = new Set(ctx.past.filter((p) => p.outcome === "answered").map((p) => topicKey(p.topic)));
  const ask = (refused?: string) =>
    completeJSON({ name: "interview-turn", schema: InterviewTurnOut, system: INTERVIEW_SYSTEM, user: interviewPrompt({ ...ctx, thread: answered?.thread, followUpsLeft, refused }), maxTokens: 2000, usage });
  let out = await ask();
  if (answered)
    for (const f of out.facts.filter((f) => f.text.trim()))
      await addFact(userId, { text: f.text.trim(), kind: f.kind, source: "interview", quote: answered.turn.answer ?? "", turnId: answered.turn.id, flags: f });
  const rootKey = answered ? topicKey(answered.root.topic) : "";
  const allowed = (n: InterviewTurnOut["next"]) => {
    if (n.type === "done" || !n.question.trim()) return true;
    const k = topicKey(n.topic);
    if (closed.has(k)) return false;
    // A follow-up stays on its topic; a new topic must be new.
    if (n.type === "follow_up") return followUpsLeft > 0 && !!answered;
    return k !== rootKey && !covered.has(k);
  };
  if (!allowed(out.next)) {
    const retry = await ask(out.next.topic);
    out = { facts: out.facts, next: allowed(retry.next) ? retry.next : { type: "done", topic: "", question: "", why: "" } };
  }
  if (answered) await db.update(schema.interviewTurns).set({ costUsd: addUsd(usage) ?? answered.turn.costUsd }).where(eq(schema.interviewTurns.id, answered.turn.id));
  const n = out.next;
  if (n.type === "done" || !n.question.trim()) return { note: DONE_NOTE };
  const follow = n.type === "follow_up" && answered;
  await db.insert(schema.interviewTurns).values({
    userId,
    topic: follow ? answered.root.topic : n.topic.trim().slice(0, 120) || "general",
    question: n.question.trim().slice(0, 600),
    why: n.why.trim().slice(0, 300),
    parentId: follow ? answered.root.id : null,
    ...(!answered && { costUsd: addUsd(usage) }),
  });
  return { note: null };
}

/** Model trouble never loses the answer: it's saved first, and the person sees what went wrong. */
async function safeStep(userId: string, answered: Parameters<typeof interviewStep>[1]) {
  try {
    return await interviewStep(userId, answered);
  } catch (e) {
    if (e instanceof BudgetError) return { note: e.message };
    if (e instanceof AiConfigError) return { note: "Lookout's AI isn't set up yet, so it can't pick the next question. An admin can set it up under Admin > AI settings." };
    console.error("[interview] step failed", e);
    return { note: answered ? "Your answer is saved. Lookout couldn't read it just now; try again in a minute." : "Lookout couldn't pick the next question just now. Try again in a minute." };
  }
}

/** Make sure there is a question waiting, unless there is nothing left to ask. */
async function ensureNext(userId: string): Promise<{ note: string | null }> {
  const turns = await turnsOf(userId);
  if (turns.some((t) => t.outcome === "pending")) return { note: null };
  const q = await nextSetup(userId, turns);
  if (q) {
    await db.insert(schema.interviewTurns).values({ userId, topic: `setup: ${q.key}`, question: setupQuestionText(q), why: SETUP_WHY, setupKey: q.key });
    return { note: null };
  }
  return safeStep(userId, null);
}

/** A setup answer goes onto the search's answers, as if typed on the Questions page, and replaces its fact. */
async function saveSetupAnswer(userId: string, turn: Turn, text: string) {
  const search = await getActiveSearch(userId);
  const q = search && kindOf(search.kind).questions.find((x) => x.key === turn.setupKey);
  if (!search || !q) return;
  const r = readSetupAnswer(q, text);
  const auto = { ...search.autofilled };
  for (const k of Object.keys(r.answers)) delete auto[k];
  await db.update(schema.searches).set({ answers: { ...search.answers, ...r.answers }, autofilled: auto, updatedAt: new Date() }).where(eq(schema.searches.id, search.id));
  await db.delete(schema.profileFacts).where(and(eq(schema.profileFacts.userId, userId), eq(schema.profileFacts.setupKey, q.key)));
  await addFact(userId, { text: r.fact.text, kind: r.fact.kind, source: "setup", quote: text, turnId: turn.id, setupKey: q.key });
}

export type Action = "answer" | "skip" | "not_applicable";

/** Answer, skip or rule out the waiting question, then line up the next one. */
export async function act(userId: string, turnId: string, action: Action, text = "") {
  const outcome: TurnOutcome = action === "answer" ? "answered" : action === "skip" ? "skipped" : "not_applicable";
  if (action === "answer" && !text.trim()) throw new HttpError(400, "Type an answer first, or press Skip.");
  // Only a waiting question can be answered, so a double press doesn't save twice.
  const [turn] = await db
    .update(schema.interviewTurns)
    .set({ outcome, answer: action === "answer" ? text.trim() : null, answeredAt: new Date() })
    .where(and(eq(schema.interviewTurns.id, turnId), eq(schema.interviewTurns.userId, userId), eq(schema.interviewTurns.outcome, "pending")))
    .returning();
  if (!turn) throw new HttpError(409, "That question was already answered. Reload to see the next one.");
  if (turn.setupKey) {
    if (action === "answer") await saveSetupAnswer(userId, turn, text);
    return ensureNext(userId);
  }
  if (action !== "answer") return ensureNext(userId);
  const root = turn.parentId ? ((await db.select().from(schema.interviewTurns).where(eq(schema.interviewTurns.id, turn.parentId)))[0] ?? turn) : turn;
  const thread = (await turnsOf(userId)).filter((t) => t.id === root.id || t.parentId === root.id).map((t) => ({ question: t.question, answer: t.answer }));
  return safeStep(userId, { turn, root, thread });
}

export type ViewFact = { id: string; text: string; shareable: boolean; lockReason: string | null; createdAt: string };
export type ViewTurn = {
  id: string;
  question: string;
  why: string;
  setup: boolean;
  followUp: boolean;
  outcome: TurnOutcome;
  answer: string | null;
  at: string;
  facts: ViewFact[];
};
export type InterviewView = { turns: ViewTurn[]; current: ViewTurn | null; note: string | null; knows: number; private: number };

/** What the interview page shows: the conversation so far, the waiting question, and how much Lookout knows. */
export async function interviewView(userId: string, note: string | null = null): Promise<InterviewView> {
  const turns = (await turnsOf(userId)).slice(-40);
  const facts = await db.select().from(schema.profileFacts).where(eq(schema.profileFacts.userId, userId));
  const view = (t: Turn): ViewTurn => ({
    id: t.id,
    question: t.question,
    why: t.why,
    setup: !!t.setupKey,
    followUp: !!t.parentId,
    outcome: t.outcome,
    answer: t.answer,
    at: (t.answeredAt ?? t.createdAt).toISOString(),
    facts: facts
      .filter((f) => f.turnId === t.id)
      .map((f) => ({ id: f.id, text: f.text, shareable: f.shareable, lockReason: f.lockReason, createdAt: f.createdAt.toISOString() })),
  });
  const pending = turns.filter((t) => t.outcome === "pending").at(-1);
  return {
    turns: turns.filter((t) => t.outcome !== "pending").map(view),
    current: pending ? view(pending) : null,
    note: pending ? null : note,
    knows: facts.length,
    private: facts.filter((f) => !f.shareable).length,
  };
}

/** Opening the interview: copy setup answers in once, and have a question waiting. */
export async function openInterview(userId: string) {
  await importSetupFacts(userId);
  const { note } = await ensureNext(userId);
  return interviewView(userId, note);
}

