import "server-only";
import { and, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { actedOn, activation, activeSince, GOALS, outcomes, retention, scoreSplit, searchSuccess, weekly, type MetricEvent, type OutcomeReport } from "./metrics";
import { APPLIED, topReasons } from "./quality";

const DAY = 864e5;

/** Admin > Metrics (#36): each beta goal with where it stands. Disabled accounts are left out, except from cost, which is real spend. */
export async function metrics(now = new Date()) {
  const since = new Date(now.getTime() - 12 * 7 * DAY);
  const rows = await db
    .select({ userId: schema.events.userId, type: schema.events.type, target: schema.events.target, meta: schema.events.meta, at: schema.events.at })
    .from(schema.events)
    .innerJoin(schema.users, eq(schema.users.id, schema.events.userId))
    .where(and(gte(schema.events.at, since), ne(schema.events.type, "heartbeat"), eq(schema.users.disabled, false)));
  const events = rows as MetricEvent[];
  const weeks = weekly(events, 9, now);
  // The current week is still running; goals are judged on the last full week.
  const last = weeks[weeks.length - 2];
  const monthAgo = new Date(now.getTime() - 30 * DAY);
  const [{ usd }] = await db
    .select({ usd: sql<string>`coalesce(sum(${schema.runs.costUsd}), 0)` })
    .from(schema.runs)
    .where(gte(schema.runs.startedAt, monthAgo));
  const monthActives = activeSince(events, monthAgo);
  const [board] = await db
    .select({ interviews: sql<number>`count(*)::int`, offers: sql<number>`count(*) filter (where ${schema.userOpportunities.stage} = 'Offer')::int` })
    .from(schema.userOpportunities)
    .innerJoin(schema.users, eq(schema.users.id, schema.userOpportunities.userId))
    .where(and(inArray(schema.userOpportunities.stage, ["Interview", "Offer"]), eq(schema.users.disabled, false)));
  // Yes answers to survey questions tagged as an interview or offer (#526), with whether the person has one on the board.
  const reports = (await db
    .select({
      userId: schema.surveyAnswers.userId,
      outcome: schema.surveyQuestions.outcome,
      boardInterview: sql<boolean>`exists (select 1 from ${schema.userOpportunities} uo where uo.user_id = "survey_answers"."user_id" and uo.stage in ('Interview', 'Offer'))`,
      boardOffer: sql<boolean>`exists (select 1 from ${schema.userOpportunities} uo where uo.user_id = "survey_answers"."user_id" and uo.stage = 'Offer')`,
    })
    .from(schema.surveyAnswers)
    .innerJoin(schema.surveyQuestions, eq(schema.surveyQuestions.id, schema.surveyAnswers.questionId))
    .innerJoin(schema.users, eq(schema.users.id, schema.surveyAnswers.userId))
    .where(and(isNotNull(schema.surveyQuestions.outcome), eq(schema.surveyAnswers.answer, schema.surveyQuestions.outcomeAnswer), eq(schema.users.disabled, false)))) as OutcomeReport[];
  const [{ asked }] = await db.select({ asked: sql<number>`count(*)::int` }).from(schema.surveyQuestions).where(isNotNull(schema.surveyQuestions.outcome));
  const outcome = outcomes(board, reports);
  const week4 = retention(events, 4, now);
  const week8 = retention(events, 8, now);

  // Activation: profile, resume and a first finished search within 7 days of joining.
  // "users"."id" is written out: drizzle renders a column here as a bare "id", which the subquery reads as its own row's id.
  const joiners = await db
    .select({
      createdAt: schema.users.createdAt,
      profileSaved: sql<boolean>`exists (select 1 from ${schema.searches} s where s.user_id = "users"."id" and s.saved_at is not null)`,
      resume: sql<boolean>`exists (select 1 from ${schema.materials} m where m.user_id = "users"."id" and m.kind = 'resume')`,
      firstSearchAt: sql<Date | null>`(select min(r.finished_at) from ${schema.runs} r where r.user_id = "users"."id" and r.status = 'done' and r.trigger in ('scheduled', 'manual'))`,
    })
    .from(schema.users)
    .where(eq(schema.users.disabled, false));
  const activated = activation(joiners.map((j) => ({ ...j, firstSearchAt: j.firstSearchAt ? new Date(j.firstSearchAt) : null })), now);

  // Quality: finds Lookout added in the last 90 days, same rules as Admin > Finds quality, plus find clicks from events.
  const quarterAgo = new Date(now.getTime() - 90 * DAY);
  const finds = await db
    .select({
      userId: schema.userOpportunities.userId,
      opportunityId: schema.userOpportunities.opportunityId,
      addedAt: schema.userOpportunities.addedAt,
      seenAt: schema.userOpportunities.seenAt,
      pinned: schema.userOpportunities.pinned,
      stage: schema.userOpportunities.stage,
      feedback: schema.userOpportunities.feedback,
      score: schema.userOpportunities.score,
    })
    .from(schema.userOpportunities)
    .innerJoin(schema.users, eq(schema.users.id, schema.userOpportunities.userId))
    .where(and(eq(schema.userOpportunities.addedVia, "agent"), gte(schema.userOpportunities.addedAt, quarterAgo), eq(schema.users.disabled, false)));
  const touched = new Set<string>();
  for (const e of events) {
    const find = actedOn(e);
    if (find) touched.add(`${e.userId}:${find}`);
  }
  const rated = finds.map((f) => ({ score: f.score, acted: f.pinned || (APPLIED as readonly string[]).includes(f.stage) || touched.has(`${f.userId}:${f.opportunityId}`) }));

  const searches = await db
    .select({ status: schema.runs.status, read: sql<number | null>`(${schema.runs.report} ->> 'read')::int` })
    .from(schema.runs)
    .innerJoin(schema.users, eq(schema.users.id, schema.runs.userId))
    .where(and(gte(schema.runs.startedAt, monthAgo), inArray(schema.runs.trigger, ["scheduled", "manual"]), eq(schema.users.disabled, false)));
  const cost = Number(usd);
  return {
    goals: GOALS,
    lastWeek: last.week,
    weeklyActives: last.active,
    actedPerActive: last.actedPerActive,
    interviews: outcome.interviews,
    retention: week4,
    week8,
    activation: activated,
    offers: outcome.offers,
    outcomes: { board, survey: outcome.survey, questions: asked },
    quality: { days: 90, added: finds.length, acted: rated.filter((f) => f.acted).length, notFit: finds.filter((f) => f.feedback).length, topReason: topReasons(finds, 1)[0] ?? null, score: scoreSplit(rated) },
    search: searchSuccess(searches),
    costMonth: cost,
    monthActives,
    costPerActiveMonth: monthActives ? cost / monthActives : null,
    weeks: weeks.slice(0, -1),
  };
}
