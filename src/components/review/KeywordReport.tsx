"use client";

import Link from "next/link";
import { useState } from "react";
import type { KeywordRow } from "@/lib/application/evidence";
import { btn } from "../Settings";
import { api } from "../store";
import { card, muted, type Detail } from "./shared";
import { color } from "@/lib/tokens";

export function KeywordReport({ d, rows, reload, locked }: { d: Detail; rows: KeywordRow[]; reload: () => Promise<unknown>; locked: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [story, setStory] = useState("");
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const used = rows.filter((r) => r.used);
  const k = d.report.keywords ?? [];

  const send = async (key: string, json: Record<string, unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await api(`/api/apply/${d.id}/keywords`, { method: "POST", json });
      await reload();
      setOpen(null);
      setStory("");
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const add = async () => {
    if (await send("__add", { action: "add", term: term.trim(), ...(story.trim() ? { story: story.trim() } : {}) })) setTerm("");
  };
  const line: React.CSSProperties = { fontSize: 14, lineHeight: 1.45 };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Keywords for this resume</div>
      <div style={muted}>
        {d.keywordsApproved
          ? `You approved these ${used.length} keywords and the resume below uses them. Change the list and you'll be asked again.`
          : "Each keyword shows where the posting asks for it and the line of your own experience that backs it. Lookout uses none of them until you press \u201cUse these keywords\u201d."}
        {d.keywordsApproved && k.length > 0 && ` Keyword match ${k.filter((x) => x.before).length}/${k.length} → ${k.filter((x) => x.after).length}/${k.length}.`}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => {
          const editing = open === r.term;
          return (
            <li key={r.term} style={{ padding: 12, borderRadius: 12, border: `1.5px solid ${r.removed ? color.border : r.support ? "#CFE3C6" : "#E8B4AA"}`, background: r.removed ? "#F4F1EC" : "#fff", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 15, textDecoration: r.removed ? "line-through" : "none", color: r.removed ? color.t2 : "inherit" }}>{r.term}</span>
                {r.removed ? (
                  <span style={{ ...muted, fontSize: 13 }}>removed</span>
                ) : !r.support ? (
                  <span style={{ fontSize: 13, fontWeight: 600, color: color.brick }}>unsupported</span>
                ) : null}
                {r.mine && <span style={{ ...muted, fontSize: 13 }}>added by you</span>}
                {!locked && (
                  <button onClick={() => send(r.term, { action: r.removed ? "restore" : "remove", term: r.term })} disabled={!!busy} style={{ ...btn("text"), marginLeft: "auto" }}>
                    {r.removed ? "Put back" : "Remove"}
                  </button>
                )}
              </div>
              <div style={line}>
                <span style={{ fontWeight: 600 }}>Posting: </span>
                {r.snippet ? `\u201c${r.snippet}\u201d` : <span style={muted}>{r.mine ? "You added this one." : "Not found in the posting text."}</span>}
              </div>
              <div style={line}>
                <span style={{ fontWeight: 600 }}>Your experience: </span>
                {r.support ? (
                  <>
                    \u201c{r.support.line}\u201d <span style={muted}>({r.support.from === "notes" ? "your experience notes" : "your master resume"})</span>
                  </>
                ) : (
                  <span style={{ color: color.brick }}>Nothing in your resume or experience notes shows this, so it stays out of the resume unless you add the experience.</span>
                )}
              </div>
              {!locked && !r.removed && !editing && (!r.support || r.support.from === "notes") && (
                <button
                  onClick={() => {
                    setOpen(r.term);
                    setStory(r.support?.line ?? "");
                  }}
                  disabled={!!busy}
                  style={{ ...btn("text"), alignSelf: "flex-start" }}
                >
                  {r.support ? "Edit this line" : "Add your experience"}
                </button>
              )}
              {!locked && !r.removed && r.support?.from === "resume" && <div style={{ ...muted, fontSize: 13 }}>To change this line, edit your master resume on <Link href="/profile/materials">Materials</Link>.</div>}
              {editing && !locked && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                  <label htmlFor="kw-story" style={{ fontSize: 14, fontWeight: 600 }}>
                    Where have you done “{r.term}”?
                  </label>
                  <div style={muted}>A role, a project, a result your resume leaves out. It goes into your experience notes and every later application can use it. You can edit it on your profile too.</div>
                  <textarea id="kw-story" value={story} onChange={(e) => setStory(e.target.value)} rows={3} maxLength={1500} placeholder="e.g. I use Claude and Claude Code daily; I built a multi-agent setup that writes and ships code for my side project." style={{ borderRadius: 10, border: "1.5px solid #E0D9CF", padding: 10, fontSize: 15, fontFamily: "inherit", resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => send(r.term, { action: "experience", term: r.term, story: story.trim() })} disabled={!!busy || !story.trim()} style={btn("solid")}>
                      Save
                    </button>
                    <button onClick={() => setOpen(null)} disabled={!!busy} style={btn("text")}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!locked && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label htmlFor="kw-add" style={{ fontSize: 14, fontWeight: 600 }}>
            Add your own keyword
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input id="kw-add" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={80} placeholder="e.g. design systems" style={{ height: 40, borderRadius: 10, border: "1.5px solid #E0D9CF", padding: "0 10px", fontSize: 15, flex: "1 1 200px" }} />
            <button onClick={add} disabled={!!busy || !term.trim()} style={btn("outline")}>
              Add
            </button>
          </div>
        </div>
      )}
      {!locked && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid #E6E0D8" }}>
          <div style={{ fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>Final list ({used.length}): </span>
            {used.map((r) => r.term).join(", ") || "none yet"}
            {rows.some((r) => !r.removed && !r.support) && <span style={muted}> · unsupported keywords stay out</span>}
          </div>
          {!d.keywordsApproved && (
            <button onClick={() => send("__approve", { action: "approve" })} disabled={!!busy || !used.length} style={{ ...btn("solid"), alignSelf: "flex-start" }}>
              {busy === "__approve" ? "Writing the resume…" : "Use these keywords"}
            </button>
          )}
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 14, color: color.brick }}>{err}</div>}
    </div>
  );
}
