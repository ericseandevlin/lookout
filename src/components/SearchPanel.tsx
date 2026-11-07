"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { RunReport } from "@/lib/db/schema";
import type { RunInfo } from "@/lib/types";
import { CheckIcon, XIcon } from "./icons";
import { useStore } from "./store";
import { trackClient } from "./track";
import { color } from "@/lib/tokens";

const DISMISS_KEY = "lookout:dismissed-run";

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * The dark panel at the top of the board that tells you what Lookout is doing:
 * ready for a first search, a live search with steps and percent, or how the
 * last one ended. Only searches and link adds show here; resume scans show on Materials.
 */
export function SearchPanel({ ready }: { ready: boolean }) {
  const { state, searchNow } = useStore();
  const [dismissed, setDismissed] = useState<string>("");
  const stored = useSyncExternalStore(
    () => () => {},
    readDismissed,
    () => "",
  );
  // Finished panels show for 30 minutes after a run ends, measured from page load.
  const [mountedAt] = useState(() => Date.now());
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const run = state.run && state.run.trigger !== "resume" ? state.run : null;

  const start = async () => {
    setErr(null);
    setStarting(true);
    try {
      await searchNow();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start the search");
    } finally {
      setStarting(false);
    }
  };
  const dismiss = (id: string) => {
    setDismissed(id);
    try {
      localStorage.setItem(DISMISS_KEY, id);
    } catch {
      // per-device convenience only
    }
  };

  const active = run && (run.status === "running" || run.status === "queued");
  if (active) return <Live run={run} />;

  const recent = run && run.finishedAt && mountedAt - new Date(run.finishedAt).getTime() < 30 * 60_000;
  if (run && recent && run.id !== dismissed && run.id !== stored) return <Finished run={run} onDismiss={() => dismiss(run.id)} onRetry={start} retrying={starting} retryError={err} />;

  if (ready && !state.lastRunAt) {
    return (
      <Shell>
        <Eyebrow>You&apos;re all set</Eyebrow>
        <Title>Lookout is ready to start looking</Title>
        <Body>Your profile and resume are in. The first search reads job boards and company sites and takes a few minutes. You can leave this page; new finds show up here with a green dot.</Body>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
          <button onClick={start} disabled={starting} style={primaryBtn}>{starting ? "Starting…" : "Start first search"}</button>
          {err && <span role="alert" style={{ fontSize: 14, color: color.orange }}>{err}</span>}
        </div>
      </Shell>
    );
  }
  return null;
}

function Live({ run }: { run: RunInfo }) {
  const queued = run.status === "queued";
  const pct = Math.max(2, run.pct);
  const steps = run.log.slice(-5);
  const label = run.trigger === "url" ? "Adding your link" : queued ? "Queued" : "Searching";
  return (
    <Shell live>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: color.orange, flex: "none" }} />
        <Eyebrow>{label}</Eyebrow>
        <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#C9C1B5", fontVariantNumeric: "tabular-nums" }}>{queued ? "Waiting" : `${Math.round(pct)}%`}</span>
      </div>
      <div aria-live="polite" style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.3, textWrap: "pretty", minHeight: 25 }}>
        {run.step || "Starting"}
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
        {queued ? (
          <div className="scan-bar" style={{ height: "100%", width: "30%", background: color.orange, borderRadius: 999 }} />
        ) : (
          <div style={{ height: "100%", width: `${pct}%`, background: color.orange, borderRadius: 999, transition: "width .6s cubic-bezier(.2,.7,.2,1)" }} />
        )}
      </div>
      {steps.length > 1 && (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {steps.slice(0, -1).map((s, i, arr) => (
            <li key={s.at + s.text} className="lk-in" style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 14, lineHeight: 1.4, color: "#C9C1B5", opacity: 0.45 + (0.55 * (i + 1)) / arr.length }}>
              <CheckIcon size={13} stroke={color.orange} style={{ flex: "none", marginTop: 3 }} />
              <span style={{ textWrap: "pretty" }}>{s.text}</span>
            </li>
          ))}
        </ol>
      )}
      <div style={{ fontSize: 14, color: "#A89F92" }}>
        {queued ? "The search agent checks for new jobs every few minutes." : "This takes a few minutes. You can leave the page; it keeps going."}
      </div>
    </Shell>
  );
}

function Finished({ run, onDismiss, onRetry, retrying, retryError }: { run: RunInfo; onDismiss: () => void; onRetry: () => void; retrying: boolean; retryError: string | null }) {
  const failed = run.status === "failed";
  const title = failed
    ? run.trigger === "url" ? "Couldn't add that link" : "The search didn't finish"
    : run.added
      ? `${run.added} new ${run.added === 1 ? "find" : "finds"} on your board`
      : run.trigger === "url" ? "That posting is already on your board" : "No new finds this time";
  const body = failed
    ? run.error || "Something went wrong."
    : run.added
      ? "They're marked with a green dot. Open one to see why it matched."
      : run.found
        ? `Lookout read ${run.found} matching ${run.found === 1 ? "posting" : "postings"}, and they're already on your board. It'll look again on your schedule.`
        : "Nothing new matched your profile. It'll look again on your schedule.";
  return (
    <Shell>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {failed ? <XIcon stroke={color.orange} /> : <CheckIcon size={15} stroke={color.orange} />}
            <Eyebrow>{failed ? "Didn't finish" : "Search complete"}</Eyebrow>
          </div>
          <Title>{title}</Title>
          <Body>{body}</Body>
          {!failed && run.report && <Report r={run.report} />}
          {failed && run.trigger !== "url" && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
              <button onClick={onRetry} disabled={retrying} style={primaryBtn}>{retrying ? "Starting…" : "Try again"}</button>
              {retryError && <span role="alert" style={{ fontSize: 14, color: color.orange }}>{retryError}</span>}
            </div>
          )}
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" style={{ border: 0, background: "rgba(255,255,255,.1)", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, lineHeight: 1, flex: "none" }}>×</button>
      </div>
    </Shell>
  );
}

/** The last search's report, opened from the board header after the live panel is gone. */
export function LastReport({ at, added, report, onClose }: { at: string; added: number; report: RunReport; onClose: () => void }) {
  const when = new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <Shell>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <Eyebrow>Last search · {when}</Eyebrow>
          <Title>{added ? `${added} new ${added === 1 ? "find" : "finds"} added` : "No new finds"}</Title>
          <Report r={report} />
        </div>
        <button onClick={onClose} aria-label="Close report" style={{ border: 0, background: "rgba(255,255,255,.1)", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, lineHeight: 1, flex: "none" }}>×</button>
      </div>
    </Shell>
  );
}

/** What the search did, where postings dropped out, and what to change. */
function Report({ r }: { r: RunReport }) {
  const t = r.tally;
  const steps: [number, string][] = [
    [r.queries.length, r.queries.length === 1 ? "search" : "searches"],
    [r.results, r.results === 1 ? "result" : "results"],
    [r.read, "pages read"],
    [t.postings, t.postings === 1 ? "job post" : "job posts"],
    [t.added, "added"],
  ];
  const outs = [
    t.known && `${t.known} already on your board`,
    t.dealbreaker && `${t.dealbreaker} hit a dealbreaker`,
    t.belowFloor && `${t.belowFloor} under your pay floor`,
    t.offLocation && `${t.offLocation} off on location`,
  ].filter(Boolean) as string[];
  const closedNote = t.closed ? `${t.closed} ${t.closed === 1 ? "posting on your board was" : "postings on your board were"} taken down, so ${t.closed === 1 ? "it's" : "they're"} now Closed and archived.` : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
      <ol aria-label="What this search did" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 0" }}>
        {steps.map(([n, label], i) => (
          <li key={label} style={{ display: "flex", alignItems: "baseline", gap: 5, fontSize: 14, color: "#C9C1B5" }}>
            {i > 0 && <span aria-hidden style={{ color: color.t2, margin: "0 8px" }}>→</span>}
            <span style={{ fontSize: 16, fontWeight: 700, color: i === steps.length - 1 ? color.orange : "#fff", fontVariantNumeric: "tabular-nums" }}>{n}</span>
            {label}
          </li>
        ))}
      </ol>
      {outs.length > 0 && <div style={{ fontSize: 14, color: "#A89F92" }}>Of the job posts: {outs.join(" · ")}. Pay and location only mark a role down; it still goes on your board.</div>}
      {closedNote && <div style={{ fontSize: 14, color: "#A89F92" }}>{closedNote}</div>}
      {r.tips.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {r.tips.map((tip) => (
            <li key={tip.text} style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", padding: "11px 13px", borderRadius: 10, background: "rgba(255,255,255,.06)" }}>
              <span style={{ flex: "1 1 280px", fontSize: 14, lineHeight: 1.45, color: "#E9E3DA", textWrap: "pretty" }}>{tip.text}</span>
              {tip.href && (
                <Link href={tip.href} onClick={() => trackClient("tip_clicked", tip.href)} style={{ flex: "none", fontSize: 14, fontWeight: 600, color: color.orange, textDecoration: "none", whiteSpace: "nowrap" }}>{tip.label ?? "Edit"}</Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {r.queries.length > 0 && (
        <details style={{ fontSize: 14, color: "#A89F92" }}>
          <summary style={{ cursor: "pointer", width: "fit-content" }}>See the searches it ran</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, color: "#C9C1B5" }}>
            {r.queries.map((q) => <li key={q} style={{ wordBreak: "break-word" }}>{q}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = { height: 38, padding: "0 16px", borderRadius: 999, border: 0, background: color.orange, color: color.ink, fontSize: 14, fontWeight: 600, cursor: "pointer" };

const Shell = ({ children, live }: { children: React.ReactNode; live?: boolean }) => (
  <div className="setup board-sec lk-in" style={{ background: color.ink, color: "#fff", display: "flex", flexDirection: "column", gap: live ? 14 : 10 }}>{children}</div>
);
const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: color.orange }}>{children}</div>
);
const Title = ({ children }: { children: React.ReactNode }) => (
  <div className="setup-title" style={{ fontWeight: 700, letterSpacing: "-0.01em", textWrap: "pretty" }}>{children}</div>
);
const Body = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 14, lineHeight: 1.5, color: "#C9C1B5", maxWidth: 620, textWrap: "pretty" }}>{children}</div>
);
