"use client";

import { useEffect, useState } from "react";
import { input, Tabs, when } from "./admin/shared";
import { PageHead } from "./Profile";
import { api } from "./store";
import { color } from "@/lib/tokens";

type Row = { id: string; source: string; message: string; stack: string | null; path: string | null; method: string | null; digest: string | null; at: string };
type Data = { rows: Row[]; day: number; week: number };

const card: React.CSSProperties = { background: "#fff", borderRadius: 16, overflow: "hidden", marginTop: 8 };
const muted: React.CSSProperties = { fontSize: 14, color: color.t2 };

/** /admin/errors: unexpected server errors Lookout recorded itself (#12), newest first, searchable. */
export function AdminErrors() {
  const [q, setQ] = useState("");
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api<Data>(`/api/admin/errors?q=${encodeURIComponent(q)}`)
        .then((r) => {
          setD(r);
          setErr(null);
        })
        .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="page-pad settings lk-page" style={{ display: "flex", flexDirection: "column", maxWidth: 1000, gap: 4 }}>
      <PageHead eyebrow="Admin" title="Errors" intro="Server errors Lookout hit, recorded by Lookout itself: failed requests, pages that crashed and scheduler failures. Kept 30 days. Paths never include the query string.">
        <Tabs />
      </PageHead>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12, fontSize: 14, fontWeight: 600 }}>
        Search
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Message, path, source or digest" style={input} />
      </label>
      {err && <div role="alert" style={{ fontSize: 14, color: color.brick }}>{err}</div>}
      {!d && !err && <div role="status" style={muted}>Loading…</div>}
      {d && (
        <>
          <div aria-live="polite" style={{ ...muted, marginTop: 8 }}>
            {d.day} in the last day · {d.week} in the last week{q.trim() ? ` · ${d.rows.length}${d.rows.length === 100 ? "+" : ""} matching` : ""}
          </div>
          {!d.rows.length ? (
            <div style={{ ...card, padding: "16px 18px", ...muted }}>{q.trim() ? "Nothing matches." : "No errors recorded."}</div>
          ) : (
            <ul style={{ ...card, listStyle: "none", padding: 0 }}>
              {d.rows.map((r) => (
                <li key={r.id} style={{ borderBottom: `1px solid ${color.surface}`, padding: "10px 14px" }}>
                  <details>
                    <summary style={{ cursor: "pointer", fontSize: 14 }}>
                      <span style={{ ...muted, fontVariantNumeric: "tabular-nums" }}>{when(r.at)}</span> · <span style={{ fontWeight: 600 }}>{r.source}</span>
                      {r.path && <span style={muted}> · {r.method ? `${r.method} ` : ""}{r.path}</span>}
                      <div style={{ marginTop: 4, overflowWrap: "anywhere" }}>{r.message}</div>
                    </summary>
                    {r.digest && <div style={{ ...muted, marginTop: 6 }}>Digest {r.digest}</div>}
                    {r.stack && <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: color.surface, borderRadius: 10, padding: 10, marginTop: 6 }}>{r.stack}</pre>}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
