"use client";

import { useEffect, useState } from "react";
import { Tabs } from "./Admin";
import { PageHead } from "./Profile";
import { Section } from "./Settings";
import { api } from "./store";
import { color } from "@/lib/tokens";

type Rate = { eligible: number; rate: number | null };
type Data = {
  goals: { weeklyActives: number; actedPerActive: number; interviews: number; week4Retention: number; costPerActiveMonth: number };
  lastWeek: string;
  weeklyActives: number;
  actedPerActive: number;
  interviews: number;
  retention: Rate & { retained: number };
  week8: Rate & { retained: number };
  activation: Rate & { activated: number };
  weekOne: Rate & { opened: number; changed: number; reached: number };
  offers: number;
  outcomes: { board: { interviews: number; offers: number }; survey: { interviews: number; offers: number }; questions: number };
  quality: { days: number; added: number; acted: number; notFit: number; topReason: { reason: string; count: number } | null; score: { acted: number | null; ignored: number | null } };
  search: { searches: number; succeeded: number; rate: number | null };
  costMonth: number;
  monthActives: number;
  costPerActiveMonth: number | null;
  applyCost: { applications: number; avg: number | null; median: number | null; max: number | null };
  searchCost: { searches: number; avg: number | null };
  spend: { monthToDate: number; actives: number; perActive: number | null; key: { usd: number; limit: number; reset: string | null } | null };
  weeks: { week: string; active: number; acted: number; actedPerActive: number }[];
  growth: { channels: { channel: string; signups: number; joined: number; active: number }[]; invites: { sent: number; accepted: number; rate: number | null } };
};

const card: React.CSSProperties = { background: "#fff", borderRadius: 16, overflowX: "auto", marginTop: 8 };
const th: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: color.t2, textAlign: "left", padding: "10px 14px", borderBottom: `1px solid ${color.border}`, whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 14, padding: "10px 14px", borderBottom: `1px solid ${color.surface}`, fontVariantNumeric: "tabular-nums" };
const muted: React.CSSProperties = { fontSize: 14, color: color.t2 };
const day = (week: string) => new Date(`${week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const one = (n: number) => (Math.round(n * 10) / 10).toString();
const usd = (n: number) => `$${n.toFixed(2)}`;
/** Small amounts (one search, one application) need more than cents. */
const cents = (n: number | null) => (n === null ? "–" : n < 0.1 ? `$${n.toFixed(3)}` : usd(n));
const percent = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const share = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

/** /admin/metrics (#36): the beta goals from ROADMAP > Goals and where each one stands. */
export function AdminMetrics() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Data>("/api/admin/metrics").then(setD).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
  }, []);

  /** Where an outcome count comes from: finds on the board, plus people who said so in the survey (#526). */
  const from = (board: number, survey: number, stage: string, noun: string) =>
    !d
      ? ""
      : `${plural(board, "find", "finds")} at ${stage} on the board, all time` +
        (d.outcomes.questions ? `, plus ${plural(survey, "person", "people")} who reported ${noun} in the survey with none on the board` : ". No survey question counts yet (tag one in Surveys)");

  const rows = d
    ? [
        { goal: "People active in a week", now: String(d.weeklyActives), target: `${d.goals.weeklyActives}`, met: d.weeklyActives >= d.goals.weeklyActives, note: `Week of ${day(d.lastWeek)}` },
        { goal: "Finds acted on per active person, per week", now: one(d.actedPerActive), target: `${d.goals.actedPerActive}+`, met: d.weeklyActives > 0 && d.actedPerActive >= d.goals.actedPerActive, note: `Week of ${day(d.lastWeek)}` },
        { goal: "Interviews from a find", now: String(d.interviews), target: `${d.goals.interviews}+`, met: d.interviews >= d.goals.interviews, note: from(d.outcomes.board.interviews, d.outcomes.survey.interviews, "Interview or Offer", "an interview") },
        {
          goal: "Week-4 retention",
          now: percent(d.retention.rate),
          target: `${Math.round(d.goals.week4Retention * 100)}%+`,
          met: d.retention.rate === null ? null : d.retention.rate >= d.goals.week4Retention,
          note: d.retention.eligible ? `${d.retention.retained} of ${d.retention.eligible} people active in their 4th week` : "Nobody has reached week 4 yet",
        },
        {
          goal: "Cost per active person, per month",
          now: d.costPerActiveMonth === null ? "–" : usd(d.costPerActiveMonth),
          target: `under ${usd(d.goals.costPerActiveMonth)}`,
          met: d.costPerActiveMonth === null ? null : d.costPerActiveMonth < d.goals.costPerActiveMonth,
          note: `${usd(d.costMonth)} over ${d.monthActives} active ${d.monthActives === 1 ? "person" : "people"}, last 30 days`,
        },
      ]
    : [];

  const others = d
    ? [
        {
          measure: "Activation",
          now: percent(d.activation.rate),
          note: d.activation.eligible
            ? `${d.activation.activated} of ${d.activation.eligible} people who joined 7+ days ago have a saved profile and a resume, and a first search done within 7 days`
            : "Nobody joined 7+ days ago",
        },
        {
          measure: "Found Settings in week one",
          now: percent(d.weekOne.rate),
          note: d.weekOne.eligible
            ? `${d.weekOne.reached} of ${d.weekOne.eligible} people who joined 7+ days ago opened Settings or changed how often Lookout searches in their first 7 days (${d.weekOne.opened} opened Settings, ${d.weekOne.changed} changed how often). Admins left out`
            : "Nobody joined 7+ days ago since events started",
        },
        { measure: "Week-8 retention", now: percent(d.week8.rate), note: d.week8.eligible ? `${d.week8.retained} of ${d.week8.eligible} people active in their 8th week` : "Nobody has reached week 8 yet" },
        { measure: "Finds acted on", now: share(d.quality.acted, d.quality.added), note: `${d.quality.acted} of ${d.quality.added} finds Lookout added, last ${d.quality.days} days` },
        {
          measure: "Not a fit",
          now: share(d.quality.notFit, d.quality.added),
          note: d.quality.topReason ? `Top reason: ${d.quality.topReason.reason} (${d.quality.topReason.count}). All reasons in Finds quality.` : "No reasons given yet",
        },
        {
          measure: "Match score, acted on vs. not",
          now: d.quality.score.acted === null ? "–" : one(d.quality.score.acted),
          note: d.quality.score.ignored === null ? "No finds left alone" : `${one(d.quality.score.ignored)} for finds nobody acted on`,
        },
        { measure: "Offers from a find", now: String(d.offers), note: from(d.outcomes.board.offers, d.outcomes.survey.offers, "Offer", "an offer") },
        {
          measure: "AI spend this month",
          now: usd(d.spend.monthToDate),
          note:
            (d.spend.perActive === null ? "Nobody active since the 1st" : `${usd(d.spend.perActive)} per active person (${plural(d.spend.actives, "person", "people")}), since the 1st (UTC)`) +
            (d.spend.key ? `. AI key: ${usd(d.spend.key.usd)} of its ${usd(d.spend.key.limit)} limit (${percent(d.spend.key.usd / d.spend.key.limit)}); admins get an email at 70%.` : "."),
        },
        {
          measure: "AI cost of one application",
          now: cents(d.applyCost.avg),
          note: d.applyCost.applications
            ? `Average over ${plural(d.applyCost.applications, "drafted application", "drafted applications")}, all time: scan, drafts, Recruiter Analysis, redrafts and AI edits. Median ${cents(d.applyCost.median)}, worst ${cents(d.applyCost.max)}.` +
              (d.searchCost.avg !== null ? ` One search averaged ${cents(d.searchCost.avg)} over the last 30 days.` : "")
            : "No application drafted yet",
        },
        { measure: "Searches that read a page", now: percent(d.search.rate), note: `${d.search.succeeded} of ${d.search.searches} finished searches, last 30 days` },
      ]
    : [];

  return (
    <div className="page-pad settings lk-page" style={{ display: "flex", flexDirection: "column", maxWidth: 1000, gap: 4 }}>
      <PageHead eyebrow="Admin" title="Metrics" intro="The beta goals (through January 10, 2027) and where each one stands. Built from Lookout's own events, so numbers start the day events shipped. Disabled accounts are left out.">
        <Tabs />
      </PageHead>
      {err && <div role="alert" style={{ fontSize: 14, color: color.brick }}>{err}</div>}
      {!d && !err && <div role="status" style={muted}>Loading…</div>}
      {d && (
        <>
          <Section>Goals</Section>
          <div style={card}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption style={{ ...muted, textAlign: "left", padding: "12px 14px 0" }}>Weekly numbers use the last full week. Acted on means opened the posting, pinned, moved to Applied or later, or clicked the find from email.</caption>
              <thead>
                <tr>
                  <th scope="col" style={th}>Goal</th>
                  <th scope="col" style={th}>Now</th>
                  <th scope="col" style={th}>Target</th>
                  <th scope="col" style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.goal}>
                    <th scope="row" style={{ ...td, fontWeight: 400, textAlign: "left" }}>
                      {r.goal}
                      <div style={muted}>{r.note}</div>
                    </th>
                    <td style={{ ...td, fontWeight: 600 }}>{r.now}</td>
                    <td style={td}>{r.target}</td>
                    <td style={td}>{r.met === null ? "No data yet" : r.met ? "Met" : "Not yet"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Section>Other measures</Section>
          <div style={card}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption style={{ ...muted, textAlign: "left", padding: "12px 14px 0" }}>No goal set for these yet. Disabled accounts are left out.</caption>
              <thead>
                <tr>
                  <th scope="col" style={th}>Measure</th>
                  <th scope="col" style={th}>Now</th>
                </tr>
              </thead>
              <tbody>
                {others.map((r) => (
                  <tr key={r.measure}>
                    <th scope="row" style={{ ...td, fontWeight: 400, textAlign: "left" }}>
                      {r.measure}
                      <div style={muted}>{r.note}</div>
                    </th>
                    <td style={{ ...td, fontWeight: 600 }}>{r.now}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Section>By week</Section>
          <div style={card}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption style={{ ...muted, textAlign: "left", padding: "12px 14px 0" }}>Last 8 full weeks.</caption>
              <thead>
                <tr>
                  <th scope="col" style={th}>Week of</th>
                  <th scope="col" style={th}>Active</th>
                  <th scope="col" style={th}>Finds acted on</th>
                  <th scope="col" style={th}>Per active person</th>
                </tr>
              </thead>
              <tbody>
                {d.weeks.map((w) => (
                  <tr key={w.week}>
                    <th scope="row" style={{ ...td, fontWeight: 400, textAlign: "left" }}>{day(w.week)}</th>
                    <td style={td}>{w.active}</td>
                    <td style={td}>{w.acted}</td>
                    <td style={td}>{w.active ? one(w.actedPerActive) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Section>Growth</Section>
          <div style={card}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption style={{ ...muted, textAlign: "left", padding: "12px 14px 0" }}>
                Waitlist requests by where they came from, all time. Tag a channel test&apos;s link to the sign-in page with ?ref=, for example /?ref=reddit. No tag counts as direct. Active means active in the week of {day(d.lastWeek)}.
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={th}>Channel</th>
                  <th scope="col" style={th}>Signups</th>
                  <th scope="col" style={th}>Joined</th>
                  <th scope="col" style={th}>Weekly active</th>
                </tr>
              </thead>
              <tbody>
                {d.growth.channels.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ ...td, ...muted }}>No waitlist requests yet</td>
                  </tr>
                )}
                {d.growth.channels.map((c) => (
                  <tr key={c.channel}>
                    <th scope="row" style={{ ...td, fontWeight: 400, textAlign: "left" }}>{c.channel}</th>
                    <td style={td}>{c.signups}</td>
                    <td style={td}>{c.joined}</td>
                    <td style={td}>
                      {c.active} <span style={muted}>({share(c.active, c.signups)} of signups)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={card}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <th scope="row" style={{ ...td, fontWeight: 400, textAlign: "left" }}>
                    Invite acceptance
                    <div style={muted}>{d.growth.invites.sent ? `${d.growth.invites.accepted} of ${d.growth.invites.sent} invites not revoked led to an account` : "No invites yet"}</div>
                  </th>
                  <td style={{ ...td, fontWeight: 600 }}>{percent(d.growth.invites.rate)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p style={muted}>Not measured here yet: zero data incidents, and referrals.</p>
        </>
      )}
    </div>
  );
}
