import "server-only";
import { and, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { weekOf } from "./events";
import { actedOn, activation, activeSince, applyCost, byChannel, fallbacksByDay, GOALS, outcomes, retention, scoreSplit, searchSuccess, weekly, weekOneSettings, type MetricEvent, type OutcomeReport } from "./metrics";
import { APPLIED, topReasons } from "./quality";
import { isAdmin } from "./users";
import { monthStart, perActive } from "./spend";
import { keyUsage } from "./spendAlerts";

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

  // First week (#992): who found Settings or changed how often Lookout searches. Admins are left out: they built it.
  const people = await db.select({ userId: schema.users.id, createdAt: schema.users.createdAt, email: schema.users.email, isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.disabled, false));
  const weekOne = weekOneSettings(people.filter((p) => !isAdmin(p)), events, since, now);

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
    .select({
      status: schema.runs.status,
      startedAt: schema.runs.startedAt,
      read: sql<number | null>`(${schema.runs.report} ->> 'read')::int`,
      fallbacks: sql<number | null>`(${schema.runs.report} ->> 'fallbacks')::int`,
    })
    .from(schema.runs)
    .innerJoin(schema.users, eq(schema.users.id, schema.runs.userId))
    // A search skipped at the person's own cap never ran, so it is not a failed search (#990).
    .where(and(gte(schema.runs.startedAt, monthAgo), inArray(schema.runs.trigger, ["scheduled", "manual"]), eq(schema.users.disabled, false), sql`${schema.runs.request} ->> 'skipped' is null`));
  // Growth (#527): waitlist requests by channel, joined meaning an account under that email, active meaning
  // any event in the last full week; and invites not revoked, accepted meaning they signed in.
  const lastWeekActive = new Set(events.filter((e) => weekOf(e.at) === last.week).map((e) => e.userId));
  const signups = await db
    .select({ channel: schema.accessRequests.channel, userId: schema.users.id })
    .from(schema.accessRequests)
    .leftJoin(schema.users, sql`lower(${schema.users.email}) = ${schema.accessRequests.email}`)
    .where(or(isNull(schema.users.id), eq(schema.users.disabled, false)));
  const [invited] = await db
    .select({ sent: sql<number>`count(*)::int`, accepted: sql<number>`count(${schema.users.id})::int` })
    .from(schema.invites)
    .leftJoin(schema.users, sql`lower(${schema.users.email}) = ${schema.invites.email}`)
    .where(and(isNull(schema.invites.revokedAt), or(isNull(schema.users.id), eq(schema.users.disabled, false))));

  // Auto-apply cost (#991): every application drafted at least once, all time and all accounts (it is real spend).
  // The first one an account drafts also pays for building its master resume.
  const drafted = await db
    .select({ usd: sql<string | null>`${schema.applications.report} ->> 'usd'` })
    .from(schema.applications)
    .where(sql`${schema.applications.report} ->> 'draftedAt' is not null`);
  // A search, for comparison: finished searches in the last 30 days.
  const [perSearch] = await db
    .select({ searches: sql<number>`count(*)::int`, avg: sql<string | null>`avg(${schema.runs.costUsd})` })
    .from(schema.runs)
    .where(and(gte(schema.runs.startedAt, monthAgo), inArray(schema.runs.trigger, ["scheduled", "manual"]), eq(schema.runs.status, "done")));

  // Spend alerts (#990): AI spend since the 1st (UTC, when the key's limit resets), per person active since then,
  // and the key's own count against its limit when the provider reports one.
  const month = monthStart(now);
  const [{ usd: mtd }] = await db
    .select({ usd: sql<string>`coalesce(sum(${schema.runs.costUsd}), 0)` })
    .from(schema.runs)
    .where(gte(schema.runs.startedAt, month));
  const monthToDate = Number(mtd);
  const mtdActives = activeSince(events, month);
  const key = await keyUsage();

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
    weekOne,
    offers: outcome.offers,
    outcomes: { board, survey: outcome.survey, questions: asked },
    quality: { days: 90, added: finds.length, acted: rated.filter((f) => f.acted).length, notFit: finds.filter((f) => f.feedback).length, topReason: topReasons(finds, 1)[0] ?? null, score: scoreSplit(rated) },
    search: searchSuccess(searches),
    fallbacks: fallbacksByDay(searches.map((s) => ({ startedAt: new Date(s.startedAt), fallbacks: s.fallbacks })), now),
    costMonth: cost,
    monthActives,
    costPerActiveMonth: monthActives ? cost / monthActives : null,
    applyCost: applyCost(drafted.map((d) => Number(d.usd ?? 0))),
    spend: { monthToDate, actives: mtdActives, perActive: perActive(monthToDate, mtdActives), key },
    searchCost: { searches: perSearch.searches, avg: perSearch.avg === null ? null : Number(perSearch.avg) },
    weeks: weeks.slice(0, -1),
    growth: {
      channels: byChannel(signups.map((r) => ({ channel: r.channel, joined: !!r.userId, active: !!r.userId && lastWeekActive.has(r.userId) }))),
      invites: { ...invited, rate: invited.sent ? invited.accepted / invited.sent : null },
    },
  };
}
