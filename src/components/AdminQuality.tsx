"use client";

import { useEffect, useState } from "react";
import { pct, type Outcome } from "@/lib/quality";
import { Tabs } from "./Admin";
import { PageHead } from "./Profile";
import { Section } from "./Settings";
import { api } from "./store";
import { color } from "@/lib/tokens";

type Data = {
  days: number;
  total: Outcome;
  people: (Outcome & { id: string; who: string })[];
  weeks: (Outcome & { week: string })[];
  reasons: { reason: string; count: number }[];
  searches: (Outcome & { id: string; who: string; trigger: string; at: string })[];
  email: {
    people: { id: string; who: string; sent: number; clicked: number; findClicks: number }[];
    recent: { id: string; who: string; at: string; finds: number; findClicks: number; board: boolean }[];
  };
};

const card: React.CSSProperties = { background: "#fff", borderRadius: 16, padding: 0, overflowX: "auto", marginTop: 8 };
const th: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: color.t2, textAlign: "right", padding: "10px 14px", borderBottom: `1px solid ${color.border}`, whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 14, padding: "10px 14px", borderBottom: `1px solid ${color.surface}`, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const first: React.CSSProperties = { textAlign: "left" };
const muted: React.CSSProperties = { fontSize: 14, color: color.t2 };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const share = (n: number, of: number) => {
  const p = pct(n, of);
  return p === null ? "–" : `${n} (${p}%)`;
};

/** The outcome columns, shared by every table. */
const COLS: [keyof Outcome, string][] = [
  ["added", "Added"],
  ["opened", "Opened"],
  ["pinned", "Pinned"],
  ["applied", "Applied"],
  ["acted", "Acted on"],
  ["notFit", "Not a fit"],
];
const cells = (o: Outcome) => COLS.map(([k]) => <td key={k} style={td}>{k === "added" ? o.added : share(o[k], o.added)}</td>);
const head = (label: string) => (
  <thead>
    <tr>
      <th scope="col" style={{ ...th, ...first }}>{label}</th>
      {COLS.map(([k, l]) => (
        <th key={k} scope="col" style={th}>{l}</th>
      ))}
    </tr>
  </thead>
);

/** /admin/quality: are finds any good (#31)? What people did with what Lookout found. */
export function AdminQuality() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Data>("/api/admin/quality").then(setD).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
  }, []);
  const best = d ? Math.max(1, ...d.weeks.map((w) => pct(w.acted, w.added) ?? 0)) : 1;

  return (
    <div className="page-pad settings lk-page" style={{ display: "flex", flexDirection: "column", maxWidth: 1000, gap: 4 }}>
      <PageHead eyebrow="Admin" title="Finds quality" intro="What people did with the finds Lookout added, so a model or prompt change can be judged by what happened after. Acted on means pinned, or applied (Applied, Interview, Offer, Not selected or Ghosted). Finds people added themselves don't count.">
        <Tabs />
      </PageHead>
      {err && <div role="alert" style={{ fontSize: 14, color: color.brick }}>{err}</div>}
      {!d && !err && <div role="status" style={muted}>Loading…</div>}
      {d && (
        <>
          <Section>By week</Section>
          <div style={card}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption style={{ ...muted, textAlign: "left", padding: "12px 14px 0" }}>Finds added each week, last 8 weeks. The bar shows the share acted on.</caption>
              {head("Week of")}
              <tbody>
                {d.weeks.map((w) => {
                  const p = pct(w.acted, w.added);
                  return (
                    <tr key={w.week}>
                      <th scope="row" style={{ ...td, ...first, fontWeight: 400 }}>
                        <div>{day(`${w.week}T12:00:00Z`)}</div>
                        <div aria-hidden style={{ marginTop: 4, height: 6, width: 120, background: color.surface, borderRadius: 3 }}>
                          <div style={{ height: 6, width: `${((p ?? 0) / best) * 100}%`, background: color.brick, borderRadius: 3 }} />
                        </div>
                      </th>
                      {cells(w)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Section>By person</Section>
          {!d.people.length ? (
            <div style={muted}>No finds from Lookout in the last {d.days} days.</div>
          ) : (
            <div style={card}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <caption style={{ ...muted, textAlign: "left", padding: "12px 14px 0" }}>Last {d.days} days.</caption>
                {head("Person")}
                <tbody>
                  {d.people.map((p) => (
                    <tr key={p.id}>
                      <th scope="row" style={{ ...td, ...first, fontWeight: 600 }}>{p.who}</th>
                      {cells(p)}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" style={{ ...td, ...first }}>Everyone</th>
                    {cells(d.total)}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <Section>Recent searches</Section>
          {!d.searches.length ? (
            <div style={muted}>No finished searches in the last {d.days} days.</div>
          ) : (
            <div style={card}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <caption style={{ ...muted, textAlign: "left", padding: "12px 14px 0" }}>The last 25 scheduled or Search now runs, and what happened to the finds each one added.</caption>
                {head("Search")}
                <tbody>
                  {d.searches.map((s) => (
                    <tr key={s.id}>
                      <th scope="row" style={{ ...td, ...first, fontWeight: 400 }}>
                        {s.who} · {day(s.at)} · {s.trigger === "manual" ? "Search now" : "scheduled"}
                      </th>
                      {cells(s)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Section>Digest emails</Section>
          {!d.email.people.length ? (
            <div style={muted}>No digests sent in the last {d.days} days.</div>
          ) : (
            <>
              <div style={card}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <caption style={{ ...muted, textAlign: "left", padding: "12px 14px 0" }}>
                    Last {d.days} days. Clicks are counted, not opens: mail apps preload images, so opens overstate. Mail security scanners can also follow links, so a click now and then may not be a person.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" style={{ ...th, ...first }}>Person</th>
                      <th scope="col" style={th}>Sent</th>
                      <th scope="col" style={th}>With a click</th>
                      <th scope="col" style={th}>Finds clicked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.email.people.map((p) => (
                      <tr key={p.id}>
                        <th scope="row" style={{ ...td, ...first, fontWeight: 600 }}>{p.who}</th>
                        <td style={td}>{p.sent}</td>
                        <td style={td}>{share(p.clicked, p.sent)}</td>
                        <td style={td}>{p.findClicks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={card}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <caption style={{ ...muted, textAlign: "left", padding: "12px 14px 0" }}>The last 15 digests.</caption>
                  <thead>
                    <tr>
                      <th scope="col" style={{ ...th, ...first }}>Digest</th>
                      <th scope="col" style={th}>Finds in it</th>
                      <th scope="col" style={th}>Finds clicked</th>
                      <th scope="col" style={th}>Board link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.email.recent.map((g) => (
                      <tr key={g.id}>
                        <th scope="row" style={{ ...td, ...first, fontWeight: 400 }}>
                          {g.who} · {day(g.at)}
                        </th>
                        <td style={td}>{g.finds}</td>
                        <td style={td}>{g.findClicks}</td>
                        <td style={td}>{g.board ? "Clicked" : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <Section>&quot;Not a fit&quot; reasons</Section>
          {!d.reasons.length ? (
            <div style={muted}>None yet.</div>
          ) : (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 14, display: "flex", flexDirection: "column", gap: 4 }}>
              {d.reasons.map((r) => (
                <li key={r.reason}>
                  {r.reason} <span style={{ color: color.t2 }}>· {r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
