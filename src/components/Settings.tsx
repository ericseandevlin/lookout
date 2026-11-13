"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DAYS } from "@/lib/board";
import type { Settings as S } from "@/lib/types";
import { Switch } from "./Finds";
import { searchBlocker } from "@/lib/ready";
import { PageHead } from "./Profile";
import { useCounts } from "./Shell";
import { api, useStore } from "./store";
import { useConfirm } from "./Confirm";
import { useFocusTrap } from "./useFocusTrap";
import { color } from "@/lib/tokens";

const ORDER = Object.keys(DAYS);

export const Section = ({ id, children }: { id?: string; children: React.ReactNode }) => (
  <div id={id} style={{ scrollMarginTop: 16, fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: color.brick, padding: "28px 0 4px" }}>{children}</div>
);

export function Row({ title, help, danger, children }: { title: string; help: React.ReactNode; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className="set-grid">
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: danger ? color.brick : undefined }}>{title}</div>
        <div style={{ fontSize: 14, color: color.t2, marginTop: 3, lineHeight: 1.45, textWrap: "pretty" }}>{help}</div>
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function Seg<T extends string | number>({ opts, cur, pick }: { opts: [string, T][]; cur: T | ((v: T) => boolean); pick: (v: T) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {opts.map(([label, v]) => {
        const on = typeof cur === "function" ? (cur as (v: T) => boolean)(v) : cur === v;
        return (
          <button key={label} aria-pressed={on} onClick={() => pick(v)} style={{ height: 34, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${on ? color.ink : color.border}`, background: on ? color.ink : "#fff", color: on ? "#fff" : color.ink, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export const btn = (kind: "outline" | "danger" | "solid" | "text"): React.CSSProperties => ({
  height: 38, padding: "0 16px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer",
  ...(kind === "outline" && { border: "1.5px solid #1D1A0F", background: "#fff", color: color.ink }),
  ...(kind === "danger" && { border: "1.5px solid #E8B4AA", background: "#fff", color: color.brick }),
  ...(kind === "solid" && { border: 0, background: color.brick, color: "#fff" }),
  ...(kind === "text" && { border: 0, background: "transparent", color: color.ink, padding: "0 8px", textDecoration: "underline", textUnderlineOffset: 3 }),
});

export function Settings() {
  const { state, putSettings, setName, refresh, searchNow, fail } = useStore();
  const ask = useConfirm();
  const st = state.settings;
  const [name, setNameDraft] = useState(state.user.name);
  const [delModal, setDelModal] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const missing = searchBlocker(useCounts(state).answered, state.materials.resume?.status);

  useEffect(() => {
    const t = setTimeout(() => name !== state.user.name && setName(name), 600);
    return () => clearTimeout(t);
  }, [name, state.user.name, setName]);

  const put = (p: Partial<S>) => putSettings(p);
  const pickTwice = (d: string) => {
    if (st.days.includes(d)) return;
    const next = [st.days[st.days.length - 1], d].filter(Boolean).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    put({ days: next });
  };

  const resetBoard = async () => {
    if (!(await ask({ eyebrow: "Reset board", title: "Reset your board?", body: "Pins, archives, stages, notes and new-role dots are cleared. Your finds, profile and materials stay.", confirmLabel: "Reset board", danger: true }))) return;
    await api("/api/board/reset", { method: "POST" }).catch(fail);
    await refresh().catch(() => {});
  };
  const signOut = async () => {
    // Only leave once the server has ended the session; otherwise say so and stay (#202).
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (e) {
      return fail(e);
    }
    window.location.replace(`${window.location.origin}/signin?out=1`);
  };
  const runNow = async () => {
    setSearchMsg(null);
    try {
      await searchNow();
      setSearchMsg("Started. Follow along on your board; it takes a few minutes.");
    } catch (e) {
      setSearchMsg(e instanceof Error ? e.message : "Couldn't start a search");
    }
  };

  return (
    <div className="page-pad settings lk-page w-page" style={{ display: "flex", flexDirection: "column" }}>
      <PageHead eyebrow="Settings" title="Account and preferences" intro="Changes save automatically." />

      <Section>Profile</Section>
      <Row title="Name" help="Shown in the sidebar and used when Lookout drafts applications.">
        <input value={name} onChange={(e) => setNameDraft(e.target.value)} placeholder="Your full name" aria-label="Name" maxLength={120} className="f-brick" style={{ width: "100%", maxWidth: 360, height: 42, border: `1.5px solid ${color.border}`, background: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 14, outline: "none", color: color.ink }} />
      </Row>
      <Row title="Email" help="You sign in with this address. Discovery summaries are sent here too.">
        <EmailChange current={state.user.email} />
      </Row>
      <Row title="Email summary" help="A short list of new matches after each run.">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Switch on={st.digest} onClick={() => put({ digest: !st.digest })} tip="Email summary" />
          <span style={{ fontSize: 14, color: color.t2 }}>{st.digest ? `On · sent to ${state.user.email}` : "Off"}</span>
        </div>
      </Row>
      <Row title="Signed-in devices" help="You stay signed in for 30 days after your last visit on each device. Sign out anywhere you don't recognize.">
        <Devices onSignOutHere={signOut} />
      </Row>
      <Row title="Sign out" help="Sign out on this device. You'll need a new sign-in link to come back.">
        <button onClick={signOut} style={btn("outline")}>Sign out</button>
      </Row>

      <Section id="discovery">Discovery</Section>
      <Row title="How often to search" help="Lookout checks job boards and company sites on this schedule.">
        <Seg opts={[["Weekly", "Weekly"], ["Twice a week", "Twice a week"], ["Daily", "Daily"]]} cur={st.freq} pick={(v) => put({ freq: v })} />
      </Row>
      {st.freq !== "Daily" && (
        <Row
          title={st.freq === "Twice a week" ? "Run days" : "Run day"}
          help={st.freq === "Twice a week" ? `Pick two days. Choosing a third replaces the earlier pick. Runs ${st.days.map((d) => DAYS[d]).join(" and ")}.` : `Runs every ${DAYS[st.day]} morning.`}
        >
          {st.freq === "Weekly" ? (
            <Seg opts={ORDER.map((d) => [d, d] as [string, string])} cur={st.day} pick={(v) => put({ day: v })} />
          ) : (
            <Seg opts={ORDER.map((d) => [d, d] as [string, string])} cur={(v: string) => st.days.includes(v)} pick={pickTwice} />
          )}
        </Row>
      )}
      <Row title="Search now" help="Run a search right away instead of waiting for the schedule. Up to 3 a day.">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <button onClick={runNow} disabled={!!state.running || !!missing} style={{ ...btn("outline"), opacity: state.running || missing ? 0.5 : 1 }}>{state.running ? "Searching…" : "Search now"}</button>
          {(searchMsg || missing) && <span style={{ fontSize: 14, color: color.t2 }}>{searchMsg ?? (missing && <><Link href={missing.href} style={{ color: color.brick, fontWeight: 600 }}>{missing.text}</Link>.</>)}</span>}
        </div>
      </Row>

      <Section>Board</Section>
      <Row title="Density" help="Row spacing in the roles table.">
        <Seg opts={[["Comfortable", "Comfortable"], ["Compact", "Compact"]]} cur={st.density} pick={(v) => put({ density: v })} />
      </Row>
      <Row title="Getting started guide" help="The setup steps above the board.">
        <Seg opts={[["Until complete", "Until complete"], ["Always", "Always"], ["Never", "Never"]]} cur={st.setup} pick={(v) => put({ setup: v })} />
      </Row>
      <Row title="Mark as new for" help="How long an untouched role keeps its green dot.">
        <Seg opts={[["3 days", 3], ["7 days", 7], ["14 days", 14]]} cur={st.newDays} pick={(v) => put({ newDays: v })} />
      </Row>

      {state.user.isAdmin && (
        <>
          <Section>Admin</Section>
          <Row title="Admin" help="Invite people, see who's using Lookout and what it costs, and set the AI model and search.">
            <Link href="/admin" style={{ ...btn("outline"), display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Open admin</Link>
          </Row>
        </>
      )}

      <Section>Your data</Section>
      <Row title="Terms" help="The rules for using Lookout during the beta.">
        <a href="/terms" target="_blank" rel="noopener" style={{ ...btn("outline"), display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Read the terms</a>
      </Row>
      <Row title="Privacy" help="What Lookout keeps, who sees it, and the services it uses.">
        <a href="/privacy" target="_blank" rel="noopener" style={{ ...btn("outline"), display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Read the privacy page</a>
      </Row>
      <Row title="Export" help="Download your roles, stages, notes and profile as a file.">
        <a href="/api/export" download style={{ ...btn("outline"), display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Export data</a>
      </Row>
      <Row title="Reset board" help="Clears pins, archives, stages, notes and new-role dots. Your profile and materials stay.">
        <button onClick={resetBoard} className="h-danger" style={btn("danger")}>Reset board</button>
      </Row>
      <Row title="Delete everything" danger help="Permanently removes your account, profile answers, resume, links, board activity and settings. This can’t be undone.">
        <button onClick={() => setDelModal(true)} className="h-danger-solid" style={btn("solid")}>Delete everything</button>
      </Row>

      {delModal && <DeleteModal close={() => setDelModal(false)} />}
    </div>
  );
}

function DeleteModal({ close }: { close: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = text.trim().toUpperCase() === "DELETE";
  const doDelete = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await api("/api/account", { method: "DELETE", json: { confirm: "DELETE" } });
      window.location.replace(window.location.origin);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't delete");
      setBusy(false);
    }
  };
  const items = ["Profile answers", "Resume", "LinkedIn and links", "Pins and archives", "Stages and notes", "Settings"];
  return (
    <>
      <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(29,26,15,.45)", zIndex: 30 }} />
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="del-title" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 460, maxWidth: "calc(100vw - 32px)", background: "#EFEEEC", borderRadius: 16, overflow: "hidden", zIndex: 31, boxShadow: "0 24px 60px rgba(29,26,15,.3)" }}>
        <div style={{ background: color.ink, color: "#fff", padding: "22px 24px 20px", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: color.orange }}>Delete everything</div>
            <div id="del-title" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", marginTop: 6 }}>Start Lookout from scratch?</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ border: 0, background: "rgba(255,255,255,.1)", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, lineHeight: 1, flex: "none" }}>×</button>
        </div>
        <div style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 14, lineHeight: 1.5, color: color.t2 }}>This permanently deletes your account and everything in it. It can’t be undone.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginBottom: 10 }}>
            {items.map((d) => (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 500 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: color.brick, flex: "none" }} />
                {d}
              </div>
            ))}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14, color: color.t2 }}>
            <span>Type <strong style={{ color: color.ink, letterSpacing: ".06em" }}>DELETE</strong> to confirm</span>
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") close(); if (e.key === "Enter") doDelete(); }}
              placeholder="DELETE"
              className="f-brick"
              style={{ height: 42, border: `1.5px solid ${ok ? color.brick : color.border}`, background: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 14.5, letterSpacing: ".06em", outline: "none", color: color.ink }}
            />
          </label>
          {err && <div style={{ fontSize: 14, color: color.brick }}>{err}</div>}
        </div>
        <div style={{ padding: "0 24px 22px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={close} style={{ height: 42, padding: "0 18px", borderRadius: 10, border: "1.5px solid #1D1A0F", background: "#fff", fontSize: 14, fontWeight: 600, color: color.ink, cursor: "pointer" }}>Cancel</button>
          <button onClick={doDelete} disabled={!ok || busy} style={{ height: 42, padding: "0 18px", borderRadius: 10, border: 0, background: ok ? color.brick : "#D8B0A8", fontSize: 14, fontWeight: 600, color: "#fff", cursor: ok ? "pointer" : "not-allowed" }}>
            {busy ? "Deleting…" : "Delete everything"}
          </button>
        </div>
      </div>
    </>
  );
}


const inputStyle: React.CSSProperties = { width: "100%", maxWidth: 360, height: 42, border: `1.5px solid ${color.border}`, background: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 14, outline: "none", color: color.ink };

function EmailChange({ current }: { current: string }) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/account/email", { method: "POST", json: { email } });
      setMsg({ text: `Check ${email} for a confirmation link. Your email changes when you click it.`, ok: true });
      setEditing(false);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Couldn't send the confirmation", ok: false });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {editing ? (
        <div style={{ display: "flex", gap: 6, maxWidth: 460, flexWrap: "wrap" }}>
          <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); if (e.key === "Escape") setEditing(false); }} placeholder="New email" aria-label="New email" className="f-brick" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
          <button onClick={() => setEditing(false)} style={{ ...btn("outline"), border: `1.5px solid ${color.border}`, color: color.t2 }}>Cancel</button>
          <button onClick={send} disabled={busy || !email.trim()} style={btn("solid")}>{busy ? "Sending…" : "Send confirmation"}</button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 460 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", height: 42, border: `1.5px solid ${color.border}`, background: color.surface, borderRadius: 10, padding: "0 13px", fontSize: 14, color: color.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current}</div>
          <button onClick={() => { setEditing(true); setMsg(null); }} style={btn("outline")}>Change</button>
        </div>
      )}
      {msg && <span style={{ fontSize: 14, color: msg.ok ? color.greenText : color.brick, lineHeight: 1.45 }}>{msg.text}</span>}
    </div>
  );
}

type Device = { id: string; device: string; createdAt: string; lastSeenAt: string; current: boolean; seen?: string };

const ago = (iso: string, now: number) => {
  const d = Math.floor((now - new Date(iso).getTime()) / 864e5);
  return d < 1 ? "Active today" : d === 1 ? "Active yesterday" : `Active ${d} days ago`;
};

function Devices({ onSignOutHere }: { onSignOutHere: () => void }) {
  const ask = useConfirm();
  const { fail } = useStore();
  const [list, setList] = useState<Device[] | null>(null);
  const load = useCallback(
    () =>
      api<{ sessions: Device[] }>("/api/account/sessions")
        .then((r) => {
          const now = Date.now();
          setList(r.sessions.map((d) => ({ ...d, seen: ago(d.lastSeenAt, now) })));
        })
        .catch(() => setList([])),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const signOut = async (d: Device) => {
    if (d.current) return onSignOutHere();
    // A failed sign-out must say so: the device would otherwise look signed out while it isn't (#202).
    await api(`/api/account/sessions/${d.id}`, { method: "DELETE" }).catch(fail);
    load();
  };
  const others = (list ?? []).filter((d) => !d.current).length;
  const signOutOthers = async () => {
    const ok = await ask({ eyebrow: "Sign out", title: "Sign out everywhere else?", body: `${others} other ${others === 1 ? "device" : "devices"} will need a new sign-in link. You stay signed in here.`, confirmLabel: "Sign out others", danger: true });
    if (!ok) return;
    await api("/api/account/sessions/others", { method: "DELETE" }).catch(fail);
    load();
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 460 }}>
      {list === null && <span role="status" style={{ fontSize: 14, color: color.t2 }}>Loading…</span>}
      {list?.map((d) => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 9px 9px 13px", borderRadius: 10, background: "#fff", border: `1.5px solid ${color.border}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {d.device}
              {d.current && <span style={{ marginLeft: 8, fontSize: 14, fontWeight: 600, padding: "2px 7px", borderRadius: 6, background: "#E6EDD9", color: color.greenText }}>This device</span>}
            </div>
            <div style={{ fontSize: 14, color: color.t2 }}>{d.seen}</div>
          </div>
          <button onClick={() => signOut(d)} style={{ ...btn("outline"), height: 32, padding: "0 12px", fontSize: 14 }}>Sign out</button>
        </div>
      ))}
      {others > 0 && (
        <button onClick={signOutOthers} className="h-danger" style={{ ...btn("danger"), alignSelf: "flex-start", marginTop: 4 }}>Sign out everywhere else</button>
      )}
    </div>
  );
}
