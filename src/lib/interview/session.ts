import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { AiConfigError, completeJSON, emptyUsage, type Usage } from "@/lib/ai/llm";
import { assertBudget, BudgetError } from "@/lib/ai/runs";
import { traceAs } from "@/lib/ai/trace";
import { HttpError } from "@/lib/api";
import { masterForDrafts } from "@/lib/application/masterCheck";
import { kindOf } from "@/lib/kinds";
import { getActiveSearch } from "@/lib/searches";
import type { FactKind, TurnOutcome } from "@/lib/db/schema";
import { closedTopics, FACTS_IN_PROMPT, INTERVIEW_SYSTEM, interviewPrompt, asksWhatIsKnown, InterviewTurnOut, isYesNoQuestion, plainQuestion, shortWhy, STORY_ASK, STORY_FOLLOW_UP, type InterviewInput } from "./interviewer";
import { backKeywords, declineKeywords, keywordQuestion, missingKeywords, termsOf } from "./keywords";
import { factKey, isBareNo, isBareYes, isQuestionBack, lockReason, topicKey } from "./rules";
import { isAnswered, readSetupAnswer, setupFact, setupQuestionText, SETUP_WHY } from "./setup";

/**
 * The interview's flow (#1449): one pending question at a time. The first turns are the setup questions the search
 * still lacks; after that, each question comes from a gap in the person's top finds. Skip closes a topic for good.
 * Opened from an application ("Interview me", #1485), its missing keywords come first, before setup and finds.
 * Rows from before #1449's single Skip may say not_applicable; they read and close topics the same way.
 */

type Turn = typeof schema.interviewTurns.$inferSelect;

/** Follow-ups after the first question on a topic: enough for the person's part, the scope and a number. */
export const MAX_FOLLOW_UPS = 2;
/** The finds a question can come from: the 5 highest-match finds not marked Nope or Not a fit. */
export const TOP_FINDS = 5;

export const DONE_NOTE = "That's every gap Lookout sees for now. It asks again when new finds come in.";

/** A sitting ends after this long with no answer; the next visit starts a new one. */
export const SITTING_GAP_MS = 2 * 60 * 60_000;
/** The most turns one sitting shows; anything older folds into Earlier answers. */
export const SITTING_MAX = 60;
/** Earlier answers load this many turns at a time. */
export const EARLIER_PAGE = 20;
/** After this many topics in one sitting, Lookout offers a good place to stop. */
export const SOFT_STOP_TOPICS = 5;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const T = schema.interviewTurns;

export async function addFact(userId: string, f: { text: string; kind: FactKind; source: "interview" | "setup"; quote: string; turnId: string; setupKey?: string; flags?: Parameters<typeof lockReason>[2] }) {
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
  return !reason;
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
  // Only the newest facts go to the model, so the prompt doesn't grow with the interview.
  const facts = (
    await db
      .select({ text: schema.profileFacts.text, shareable: schema.profileFacts.shareable })
      .from(schema.profileFacts)
      .where(and(eq(schema.profileFacts.userId, userId), ne(schema.profileFacts.kind, "pay")))
      .orderBy(desc(schema.profileFacts.createdAt))
      .limit(FACTS_IN_PROMPT)
  ).reverse();
  // Every topic name, for the code checks; the prompt itself lists only the newest (TOPICS_IN_PROMPT).
  const past = await db
    .select({ topic: T.topic, outcome: T.outcome })
    .from(T)
    .where(and(eq(T.userId, userId), isNull(T.setupKey), ne(T.outcome, "pending")))
    .orderBy(asc(T.createdAt));
  return { profile, resume, finds, facts, past };
}

/** The next setup question the search lacks and the interview hasn't asked yet. */
async function nextSetup(userId: string) {
  const search = await getActiveSearch(userId);
  if (!search) return null;
  const asked = new Set((await db.select({ k: T.setupKey }).from(T).where(and(eq(T.userId, userId), isNotNull(T.setupKey)))).map((r) => r.k));
  const cfg = kindOf(search.kind);
  return cfg.questions.find((q) => !isAnswered(cfg, q, search.answers) && !asked.has(q.key)) ?? null;
}

const addUsd = (u: Usage) => (u.usd ? u.usd.toFixed(4) : undefined);

/**
 * One interviewer step: read the last answer (if any) for facts, then pick the next question. A topic that was
 * skipped, that doesn't apply, or (for a new topic) that was already covered is refused in code and asked for once more.
 */
async function interviewStep(userId: string, answered: { turn: Turn; root: Turn; thread: { question: string; answer: string | null }[] } | null, focus: string[] = []) {
  await assertBudget(userId);
  traceAs("interview", userId, answered?.root.id ?? userId);
  const ctx = await context(userId);
  const usage = emptyUsage();
  // A question back gets its answer and the same question again, whatever follow-ups are left.
  const askedBack = !!answered && isQuestionBack(answered.turn.answer);
  const followUpsLeft = answered ? Math.max(askedBack ? 1 : 0, MAX_FOLLOW_UPS - (answered.thread.length - 1)) : 0;
  const closed = closedTopics(ctx.past);
  const covered = new Set(ctx.past.filter((p) => p.outcome === "answered").map((p) => topicKey(p.topic)));
  // Keywords already asked about, skipped or answered, aren't asked first again.
  const priority = focus.filter((t) => ![...closed, ...covered].some((k) => k.includes(topicKey(t))));
  const ask = (refused?: string, refusedWhy?: string) =>
    completeJSON({ name: "interview-turn", schema: InterviewTurnOut, system: INTERVIEW_SYSTEM, user: interviewPrompt({ ...ctx, thread: answered?.thread, followUpsLeft, refused, refusedWhy, priority }), maxTokens: 2000, usage });
  // What the person already told Lookout: a question must not ask for it again (#1531).
  const known = [ctx.resume, ...ctx.facts.map((f) => f.text)].join("\n");
  // With no answer to follow, a "follow_up" is a first question: read it as a new topic.
  const firstAsk = (o: InterviewTurnOut): InterviewTurnOut => (!answered && o.next.type === "follow_up" ? { ...o, next: { ...o.next, type: "new_topic" } } : o);
  let out = firstAsk(await ask());
  console.info("[interview] step", { input: usage.input, output: usage.output, usd: Number(usage.usd.toFixed(4)) });
  if (answered) {
    // A follow-up shows the model the earlier answers too; a fact it says again is not saved twice.
    const seen = new Set((await db.select({ text: schema.profileFacts.text }).from(schema.profileFacts).where(eq(schema.profileFacts.userId, userId))).map((f) => factKey(f.text)));
    const shareable: string[] = [];
    for (const f of out.facts) {
      const key = factKey(f.text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (await addFact(userId, { text: f.text.trim(), kind: f.kind, source: "interview", quote: answered.turn.answer ?? "", turnId: answered.turn.id, flags: f })) shareable.push(f.text.trim());
    }
    // A keyword is backed when a fact the person may use in writing shows they did it; a private one stays background.
    const backed = focus.filter((t) => (out.backs ?? []).some((b) => topicKey(b) === topicKey(t)));
    await backKeywords(userId, backed, shareable);
  }
  const rootKey = answered ? topicKey(answered.root.topic) : "";
  const allowed = (n: InterviewTurnOut["next"]) => {
    if (n.type === "done" || !n.question.trim()) return true;
    const k = topicKey(n.topic);
    if (closed.has(k)) return false;
    if (asksWhatIsKnown(n.question, n.closest ?? "", known)) return false;
    // A follow-up stays on its topic; a new topic must be new.
    if (n.type === "follow_up") return followUpsLeft > 0 && !!answered;
    return k !== rootKey && !covered.has(k);
  };
  if (!allowed(out.next)) {
    const n0 = out.next;
    console.info("[interview] refused", { type: n0.type, topic: n0.topic });
    const retry = firstAsk(await ask(n0.topic, asksWhatIsKnown(n0.question, n0.closest ?? "", known) ? `they already told you: "${n0.closest.trim()}"` : undefined));
    out = { facts: out.facts, backs: out.backs, next: allowed(retry.next) ? retry.next : { type: "done", topic: "", question: "", why: "", closest: "" } };
  }
  // A missing keyword the model didn't ask about still gets asked, as a plain story question (#1485).
  const left = priority.filter((t) => !answered || !termsOf(answered.root.topic, [t]).length);
  if ((out.next.type === "done" || !out.next.question.trim()) && left.length && !(answered && out.next.type === "follow_up")) {
    console.info("[interview] model asked nothing; asking a keyword", { left: left.length });
    out.next = { type: "new_topic", topic: left[0], question: keywordQuestion(left[0]), why: "", closest: "" };
  }
  // "Have you done X?" alone gets a yes, not a story: the story request goes on the end (#1485).
  if (isYesNoQuestion(out.next.question)) out.next = { ...out.next, question: `${out.next.question.trim()} ${STORY_ASK}` };
  if (answered) await db.update(schema.interviewTurns).set({ costUsd: addUsd(usage) ?? answered.turn.costUsd }).where(eq(schema.interviewTurns.id, answered.turn.id));
  // A bare yes backs nothing: Lookout always asks for the story, even when the model moved on (#1485).
  // Only once per topic, so the same line never comes twice in a row.
  if (answered && !answered.turn.parentId && isBareYes(answered.turn.answer ?? "") && followUpsLeft > 0 && out.next.type !== "follow_up") out.next = { type: "follow_up", topic: answered.root.topic, question: STORY_FOLLOW_UP, why: "", closest: "" };
  const n = out.next;
  if (n.type === "done" || !n.question.trim()) return { note: DONE_NOTE };
  const follow = n.type === "follow_up" && answered;
  await db.insert(schema.interviewTurns).values({
    userId,
    topic: follow ? answered.root.topic : n.topic.trim().slice(0, 120) || "general",
    // After a question back, the line that answers it stays in front of the question.
    question: (askedBack ? n.question.trim() : plainQuestion(n.question)).slice(0, 600),
    // With no finds yet, a reason that cites finds is made up; no reason beats a wrong one (#1531).
    why: (!ctx.finds.length && /\bfinds?\b/i.test(n.why) ? "" : shortWhy(n.why)).slice(0, 300),
    parentId: follow ? answered.root.id : null,
    ...(!answered && { costUsd: addUsd(usage) }),
  });
  return { note: null };
}

/** Model trouble never loses the answer: it's saved first, and the person sees what went wrong. */
async function safeStep(userId: string, answered: Parameters<typeof interviewStep>[1], focus: string[] = []) {
  try {
    return await interviewStep(userId, answered, focus);
  } catch (e) {
    if (e instanceof BudgetError) return { note: e.message };
    if (e instanceof AiConfigError) return { note: "Lookout's AI isn't set up yet, so it can't pick the next question. An admin can set it up under Admin > AI settings." };
    console.error("[interview] step failed", e);
    return { note: answered ? "Your answer is saved. Lookout couldn't read it just now; try again in a minute." : "Lookout couldn't pick the next question just now. Try again in a minute." };
  }
}

/**
 * Make sure there is a question waiting, unless there is nothing left to ask. With focus keywords, a waiting question
 * on another topic gives way, so a keyword is the first thing asked; setup questions wait until after.
 */
async function ensureNext(userId: string, focus: string[] = []): Promise<{ note: string | null }> {
  const [waiting] = await db.select({ id: T.id, topic: T.topic }).from(T).where(and(eq(T.userId, userId), eq(T.outcome, "pending"))).limit(1);
  if (waiting && (!focus.length || termsOf(waiting.topic, focus).length)) return { note: null };
  if (waiting) {
    // Never answered, so nothing hangs off it.
    await db.delete(T).where(eq(T.id, waiting.id));
    return safeStep(userId, null, focus);
  }
  const q = !focus.length && (await nextSetup(userId));
  if (q) {
    await db.insert(schema.interviewTurns).values({ userId, topic: `setup: ${q.key}`, question: setupQuestionText(q), why: SETUP_WHY, setupKey: q.key });
    return { note: null };
  }
  return safeStep(userId, null, focus);
}

/**
 * Whether the interview has a question for this person, without a model call: one is waiting, a setup question is
 * left, or they haven't started. After the last gap, the interview waits with no question, so this is false.
 */
export async function hasOpenQuestion(userId: string) {
  const [any] = await db.select({ id: T.id }).from(T).where(eq(T.userId, userId)).limit(1);
  if (!any) return true;
  const [waiting] = await db.select({ id: T.id }).from(T).where(and(eq(T.userId, userId), eq(T.outcome, "pending"))).limit(1);
  return !!waiting || !!(await nextSetup(userId));
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

export type Action = "answer" | "skip";

/** Answer or skip the waiting question, then line up the next one. */
export async function act(userId: string, turnId: string, action: Action, text = "", appId?: string) {
  const outcome: TurnOutcome = action === "answer" ? "answered" : "skipped";
  if (action === "answer" && !text.trim()) throw new HttpError(400, "Type an answer first, or press Skip.");
  // Only a waiting question can be answered, so a double press doesn't save twice.
  const [turn] = await db
    .update(schema.interviewTurns)
    .set({ outcome, answer: action === "answer" ? text.trim() : null, answeredAt: new Date() })
    .where(and(eq(schema.interviewTurns.id, turnId), eq(schema.interviewTurns.userId, userId), eq(schema.interviewTurns.outcome, "pending")))
    .returning();
  if (!turn) throw new HttpError(409, "That question was already answered. Reload to see the next one.");
  const focus = appId ? await missingKeywords(userId, appId) : [];
  if (turn.setupKey) {
    if (action === "answer") await saveSetupAnswer(userId, turn, text);
    return ensureNext(userId, focus);
  }
  if (action === "answer" && isBareNo(text)) {
    // They haven't done it: the topic closes like a skip, and its keywords leave Missing on the application (#1485).
    await db.update(T).set({ outcome: "skipped" }).where(eq(T.id, turn.id));
    const root = turn.parentId ? ((await db.select({ topic: T.topic }).from(T).where(eq(T.id, turn.parentId)))[0] ?? turn) : turn;
    if (appId) await declineKeywords(appId, termsOf(root.topic, focus));
    return ensureNext(userId, focus.filter((t) => !termsOf(root.topic, [t]).length));
  }
  if (action !== "answer") return ensureNext(userId, focus);
  const root = turn.parentId ? ((await db.select().from(schema.interviewTurns).where(eq(schema.interviewTurns.id, turn.parentId)))[0] ?? turn) : turn;
  const thread = (
    await db
      .select({ question: T.question, answer: T.answer })
      .from(T)
      .where(and(eq(T.userId, userId), or(eq(T.id, root.id), eq(T.parentId, root.id))))
      .orderBy(asc(T.createdAt))
  ).map((t) => ({ question: t.question, answer: t.answer }));
  return safeStep(userId, { turn, root, thread }, focus);
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
export type InterviewView = {
  /** This sitting's turns, oldest first. Older ones are behind Earlier answers. */
  turns: ViewTurn[];
  current: ViewTurn | null;
  note: string | null;
  /** How many answered turns sit behind Earlier answers, and the turn to page back from. */
  earlier: number;
  earlierBefore: string | null;
  /** This sitting: topics asked (setup questions count) and facts saved. */
  sitting: { topics: number; facts: number; private: number };
  /** True when the waiting question starts a new topic after SOFT_STOP_TOPICS topics this sitting. */
  softStop: boolean;
  knows: number;
  private: number;
};

const viewOf = (t: Turn, facts: (typeof schema.profileFacts.$inferSelect)[]): ViewTurn => ({
  id: t.id,
  question: t.question,
  why: shortWhy(t.why),
  setup: !!t.setupKey,
  followUp: !!t.parentId,
  outcome: t.outcome,
  answer: t.answer,
  at: (t.answeredAt ?? t.createdAt).toISOString(),
  facts: facts
    .filter((f) => f.turnId === t.id)
    .map((f) => ({ id: f.id, text: f.text, shareable: f.shareable, lockReason: f.lockReason, createdAt: f.createdAt.toISOString() })),
});

const factsFor = (userId: string, ids: string[]) =>
  ids.length ? db.select().from(schema.profileFacts).where(and(eq(schema.profileFacts.userId, userId), inArray(schema.profileFacts.turnId, ids))) : Promise.resolve([]);

/**
 * The turns of this sitting: answered turns, newest back, each within SITTING_GAP_MS of the one after it, the newest
 * within SITTING_GAP_MS of now. Reads at most SITTING_MAX + 1 rows, through the (user_id, created_at) index.
 */
function sittingOf(recent: Turn[], now = Date.now()) {
  const out: Turn[] = [];
  let after = now;
  for (const t of recent) {
    const at = (t.answeredAt ?? t.createdAt).getTime();
    if (after - at > SITTING_GAP_MS) break;
    out.push(t);
    after = at;
  }
  return out.reverse();
}

/** What the interview page shows: this sitting, the waiting question, and how much Lookout knows. */
export async function interviewView(userId: string, note: string | null = null): Promise<InterviewView> {
  const [pending] = await db.select().from(T).where(and(eq(T.userId, userId), eq(T.outcome, "pending"))).orderBy(desc(T.createdAt)).limit(1);
  const recent = await db.select().from(T).where(and(eq(T.userId, userId), ne(T.outcome, "pending"))).orderBy(desc(T.createdAt), desc(T.id)).limit(SITTING_MAX);
  const sitting = sittingOf(recent);
  const [{ n: answered }] = await db.select({ n: count() }).from(T).where(and(eq(T.userId, userId), ne(T.outcome, "pending")));
  const [{ n: knows }] = await db.select({ n: count() }).from(schema.profileFacts).where(eq(schema.profileFacts.userId, userId));
  const [{ n: priv }] = await db.select({ n: count() }).from(schema.profileFacts).where(and(eq(schema.profileFacts.userId, userId), eq(schema.profileFacts.shareable, false)));
  const facts = await factsFor(userId, [...sitting.map((t) => t.id), ...(pending ? [pending.id] : [])]);
  const topics = sitting.filter((t) => !t.parentId).length;
  const sittingFacts = facts.filter((f) => f.turnId !== pending?.id);
  return {
    turns: sitting.map((t) => viewOf(t, facts)),
    current: pending ? viewOf(pending, facts) : null,
    note: pending ? null : note,
    earlier: answered - sitting.length,
    earlierBefore: sitting[0]?.id ?? null,
    sitting: { topics, facts: sittingFacts.length, private: sittingFacts.filter((f) => !f.shareable).length },
    softStop: !!pending && !pending.parentId && topics >= SOFT_STOP_TOPICS,
    knows,
    private: priv,
  };
}

/**
 * One page of Earlier answers: the EARLIER_PAGE answered turns just before `before` (or the newest, without it),
 * oldest first. Keyset paging on (created_at, id), so page 5 costs what page 1 does.
 */
export async function earlierTurns(userId: string, before: string | null, limit = EARLIER_PAGE) {
  const [cur] = before ? await db.select({ at: T.createdAt, id: T.id }).from(T).where(and(eq(T.id, before), eq(T.userId, userId))) : [];
  if (before && !cur) throw new HttpError(404, "That turn isn't there anymore. Reload the page.");
  const rows = await db
    .select()
    .from(T)
    .where(and(eq(T.userId, userId), ne(T.outcome, "pending"), cur ? or(lt(T.createdAt, cur.at), and(eq(T.createdAt, cur.at), lt(T.id, cur.id))) : undefined))
    .orderBy(desc(T.createdAt), desc(T.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit).reverse();
  const facts = await factsFor(userId, page.map((t) => t.id));
  return { turns: page.map((t) => viewOf(t, facts)), more: rows.length > limit };
}

/** Opening the interview: copy setup answers in once, and have a question waiting. */
export async function openInterview(userId: string, appId?: string) {
  await importSetupFacts(userId);
  const { note } = await ensureNext(userId, appId ? await missingKeywords(userId, appId) : []);
  return interviewView(userId, note);
}

