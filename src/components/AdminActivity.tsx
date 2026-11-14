"use client";

import { useEffect, useState } from "react";
import { EVENT_LABEL, type EventType } from "@/lib/events";
import { Tabs } from "./Admin";
import { PageHead } from "./Profile";
import { Section } from "./Settings";
import { api } from "./store";
import { color, font } from "@/lib/tokens";

type Data = {
  weeks: { week: string; active: number }[];
  funnel: { key: string; label: string; count: number }[];
  people: { id: string; who: string; next: string | null; lastSeen: string | null; events: number }[];
};
type Row = { type: string; target: string | null; at: string; minutes?: number };

const card: React.CSSProperties = { background: "#fff", borderRadius: 16, overflowX: "auto", marginTop: 8 };
const th: React.CSSProperties = { fontSize: font.xs, fontWeight: 600, color: color.t2, textAlign: "left", padding: "10px 14px", borderBottom: `1px solid ${color.border}`, whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: font.base, padding: "10px 14px", borderBottom: `1px solid ${color.surface}`, fontVariantNumeric: "tabular-nums" };
const muted: React.CSSProperties = { fontSize: font.base, color: color.t2 };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** /admin/activity: first-party product events (#35). Weekly actives, the funnel, and one person's timeline. */
export function AdminActivity() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    api<Data>("/api/admin/activity").then(setD).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
  }, []);
  const pick = async (id: string) => {
    setWho(id);
    setRows(null);
    setRows(await api<{ timeline: Row[] }>(`/api/admin/activity?user=${id}`).then((r) => r.timeline).catch(() => []));
  };
  const top = d ? Math.max(1, ...d.weeks.map((w) => w.active)) : 1;
  const accounts = d?.funnel[0]?.count ?? 0;

  return (
    <div className="page-pad settings lk-page" style={{ display: "flex", flexDirection: "column", maxWidth: 1000, gap: 4 }}>
      <PageHead eyebrow="Admin" title="Activity" intro="What people do in Lookout, recorded by Lookout itself: no third-party scripts. Events started on the day this shipped; the funnel uses data from before then too.">
        <Tabs />
      </PageHead>
      {err && <div role="alert" style={{ fontSize: font.base, color: color.brick }}>{err}</div>}
      {!d && !err && <div role="status" style={muted}>Loading…</div>}
      {d && (
        <>
          <Section>Weekly actives</Section>
          <div style={card}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption style={{ ...muted, textAlign: "left", padding: "12px 14px 0" }}>People who did anything in Lookout that week (a page, a click, an email link), last 8 weeks.</caption>
              <thead>
                <tr>
                  <th scope="col" style={th}>Week of</th>
                  <th scope="col" style={th}>Active</th>
                </tr>
              </thead>
              <tbody>
                {d.weeks.map((w) => (
                  <tr key={w.week}>
                    <th scope="row" style={{ ...td, fontWeight: 400, textAlign: "left" }}>{day(`${w.week}T12:00:00Z`)}</th>
                    <td style={td}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        <span style={{ minWidth: 20 }}>{w.active}</span>
                        <span aria-hidden style={{ display: "inline-block", height: 6, width: `${(w.active / top) * 140}px`, background: color.brick, borderRadius: 3 }} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Section>Funnel</Section>
          <div style={card}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption style={{ ...muted, textAlign: "left", padding: "12px 14px 0" }}>Everyone with an account except admins and disabled accounts, as of now. Each step counts people who also reached every step above it. Acted on means pinned or applied.</caption>
              <thead>
                <tr>
                  <th scope="col" style={th}>Step</th>
                  <th scope="col" style={th}>People</th>
                  <th scope="col" style={th}>Of accounts</th>
                </tr>
              </thead>
              <tbody>
                {d.funnel.map((s) => (
                  <tr key={s.key}>
                    <th scope="row" style={{ ...td, fontWeight: 400, textAlign: "left" }}>{s.label}</th>
                    <td style={td}>{s.count}</td>
                    <td style={td}>{accounts ? `${Math.round((s.count / accounts) * 100)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Section>People</Section>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 300px) 1fr", gap: 12, alignItems: "start", marginTop: 8 }}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, background: "#fff", borderRadius: 16, overflow: "hidden" }}>
              {d.people.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => pick(p.id)}
                    aria-pressed={who === p.id}
                    style={{ width: "100%", textAlign: "left", border: 0, borderBottom: `1px solid ${color.surface}`, background: who === p.id ? color.surface : "#fff", padding: "10px 14px", cursor: "pointer", fontSize: font.base }}
                  >
                    <div style={{ fontWeight: 600 }}>{p.who}</div>
                    <div style={muted}>{p.next ? `Next: ${p.next}` : "Done every step"}</div>
                    <div style={muted}>{p.lastSeen ? `Last seen ${when(p.lastSeen)} · ${p.events} events in 8 weeks` : "No events yet"}</div>
                  </button>
                </li>
              ))}
            </ul>
            <div aria-live="polite" style={{ background: "#fff", borderRadius: 16, padding: "12px 16px", minHeight: 120 }}>
              {!who ? (
                <div style={muted}>Pick a person to see their timeline.</div>
              ) : rows === null ? (
                <div role="status" style={muted}>Loading…</div>
              ) : !rows.length ? (
                <div style={muted}>Nothing recorded yet.</div>
              ) : (
                <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {rows.map((r, i) => (
                    <li key={i} style={{ fontSize: font.base, display: "flex", gap: 10 }}>
                      <span style={{ ...muted, minWidth: 120, fontVariantNumeric: "tabular-nums" }}>{when(r.at)}</span>
                      <span>
                        {EVENT_LABEL[r.type as EventType] ?? r.type}
                        {r.minutes ? ` · ${r.minutes} min` : ""}
                        {r.target && <span style={muted}> · {r.target.length > 40 ? `${r.target.slice(0, 40)}…` : r.target}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
