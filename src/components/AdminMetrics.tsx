"use client";

import { useEffect, useState } from "react";
import { Tabs } from "./Admin";
import { PageHead } from "./Profile";
import { Section } from "./Settings";
import { api } from "./store";

type Data = {
  goals: { weeklyActives: number; actedPerActive: number; interviews: number; week4Retention: number; costPerActiveMonth: number };
  lastWeek: string;
  weeklyActives: number;
  actedPerActive: number;
  interviews: number;
  retention: { eligible: number; retained: number; rate: number | null };
  costMonth: number;
  monthActives: number;
  costPerActiveMonth: number | null;
  weeks: { week: string; active: number; acted: number; actedPerActive: number }[];
};

const card: React.CSSProperties = { background: "#fff", borderRadius: 16, overflowX: "auto", marginTop: 8 };
const th: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: "#6B6358", textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #EEEAE4", whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 14, padding: "10px 14px", borderBottom: "1px solid #F2EEE8", fontVariantNumeric: "tabular-nums" };
const muted: React.CSSProperties = { fontSize: 14, color: "#6B6358" };
const day = (week: string) => new Date(`${week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const one = (n: number) => (Math.round(n * 10) / 10).toString();
const usd = (n: number) => `$${n.toFixed(2)}`;

/** /admin/metrics (#36): the beta goals from ROADMAP > Goals and where each one stands. */
export function AdminMetrics() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Data>("/api/admin/metrics").then(setD).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
  }, []);

  const rows = d
    ? [
        { goal: "People active in a week", now: String(d.weeklyActives), target: `${d.goals.weeklyActives}`, met: d.weeklyActives >= d.goals.weeklyActives, note: `Week of ${day(d.lastWeek)}` },
        { goal: "Finds acted on per active person, per week", now: one(d.actedPerActive), target: `${d.goals.actedPerActive}+`, met: d.weeklyActives > 0 && d.actedPerActive >= d.goals.actedPerActive, note: `Week of ${day(d.lastWeek)}` },
        { goal: "Interviews from a find", now: String(d.interviews), target: `${d.goals.interviews}+`, met: d.interviews >= d.goals.interviews, note: "Finds at Interview or Offer, all time" },
        {
          goal: "Week-4 retention",
          now: d.retention.rate === null ? "–" : `${Math.round(d.retention.rate * 100)}%`,
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

  return (
    <div className="page-pad settings lk-page" style={{ display: "flex", flexDirection: "column", maxWidth: 1000, gap: 4 }}>
      <PageHead eyebrow="Admin" title="Metrics" intro="The beta goals (through January 10, 2027) and where each one stands. Built from Lookout's own events, so numbers start the day events shipped. Disabled accounts are left out.">
        <Tabs />
      </PageHead>
      {err && <div role="alert" style={{ fontSize: 14, color: "#99220F" }}>{err}</div>}
      {!d && !err && <div style={muted}>Loading…</div>}
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
          <p style={muted}>Not measured here yet: zero data incidents, and the quality, outcome and growth numbers in #36.</p>
        </>
      )}
    </div>
  );
}
