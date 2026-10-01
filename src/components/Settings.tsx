"use client";

import { useEffect, useState } from "react";
import { DAYS } from "@/lib/board";
import type { Settings as S } from "@/lib/types";
import { Switch } from "./Finds";
import { PageHead } from "./Profile";
import { api, useStore } from "./store";

const ORDER = Object.keys(DAYS);

const Section = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#99220F", padding: "28px 0 4px" }}>{children}</div>
);

function Row({ title, help, danger, children }: { title: string; help: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className="set-grid">
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: danger ? "#99220F" : undefined }}>{title}</div>
        <div style={{ fontSize: 13, color: "#8A8175", marginTop: 3, lineHeight: 1.45, textWrap: "pretty" }}>{help}</div>
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function Seg<T extends string | number>({ opts, cur, pick }: { opts: [string, T][]; cur: T | ((v: T) => boolean); pick: (v: T) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {opts.map(([label, v]) => {
        const on = typeof cur === "function" ? (cur as (v: T) => boolean)(v) : cur === v;
        return (
          <button key={label} aria-pressed={on} onClick={() => pick(v)} style={{ height: 34, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${on ? "#1D1A0F" : "#E0D9CF"}`, background: on ? "#1D1A0F" : "#fff", color: on ? "#fff" : "#1D1A0F", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

const btn = (kind: "outline" | "danger" | "solid"): React.CSSProperties => ({
  height: 38, padding: "0 16px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
  ...(kind === "outline" && { border: "1.5px solid #1D1A0F", background: "#fff", color: "#1D1A0F" }),
  ...(kind === "danger" && { border: "1.5px solid #E8B4AA", background: "#fff", color: "#99220F" }),
  ...(kind === "solid" && { border: 0, background: "#99220F", color: "#fff" }),
});

export function Settings() {
  const { state, putSettings, setName, refresh, searchNow, fail } = useStore();
  const st = state.settings;
  const [name, setNameDraft] = useState(state.user.name);
  const [delModal, setDelModal] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);

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
    if (!confirm("Reset the board? Pins, archives, stages, notes and new-role dots will be cleared.")) return;
    await api("/api/board/reset", { method: "POST" }).catch(fail);
    await refresh().catch(() => {});
  };
  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.replace(window.location.origin);
  };
  const runNow = async () => {
    setSearchMsg(null);
    try {
      await searchNow();
      setSearchMsg("Searching now. New finds will show up on your board.");
    } catch (e) {
      setSearchMsg(e instanceof Error ? e.message : "Couldn't start a search");
    }
  };

  return (
    <div className="page-pad settings" style={{ display: "flex", flexDirection: "column", maxWidth: 820 }}>
      <PageHead eyebrow="Settings" title="Account and preferences" intro="Changes save automatically." />

      <Section>Profile</Section>
      <Row title="Name" help="Shown in the sidebar and used when Lookout drafts applications.">
        <input value={name} onChange={(e) => setNameDraft(e.target.value)} placeholder="Your full name" aria-label="Name" maxLength={120} className="f-brick" style={{ width: "100%", maxWidth: 360, height: 42, border: "1.5px solid #E6E0D8", background: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 14, outline: "none", color: "#1D1A0F" }} />
      </Row>
      <Row title="Email" help="You sign in with this address. Discovery summaries are sent here too.">
        <div style={{ display: "flex", alignItems: "center", height: 42, maxWidth: 360, border: "1.5px solid #EEEAE4", background: "#F4F1EC", borderRadius: 10, padding: "0 13px", fontSize: 14, color: "#6B6358", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state.user.email}</div>
      </Row>
      <Row title="Email summary" help="A short list of new matches after each run.">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Switch on={st.digest} onClick={() => put({ digest: !st.digest })} tip="Email summary" />
          <span style={{ fontSize: 13.5, color: "#6B6358" }}>{st.digest ? `On · sent to ${state.user.email}` : "Off"}</span>
        </div>
      </Row>
      <Row title="Sign out" help="Ends this session on this device.">
        <button onClick={signOut} style={btn("outline")}>Sign out</button>
      </Row>

      <Section>Discovery</Section>
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
          <button onClick={runNow} disabled={!!state.running} style={{ ...btn("outline"), opacity: state.running ? 0.5 : 1 }}>{state.running ? "Searching…" : "Search now"}</button>
          {searchMsg && <span style={{ fontSize: 13, color: "#6B6358" }}>{searchMsg}</span>}
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

      <Section>Your data</Section>
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
      <div role="dialog" aria-modal="true" aria-labelledby="del-title" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 460, maxWidth: "calc(100vw - 32px)", background: "#EFEEEC", borderRadius: 16, overflow: "hidden", zIndex: 31, boxShadow: "0 24px 60px rgba(29,26,15,.3)" }}>
        <div style={{ background: "#1D1A0F", color: "#fff", padding: "22px 24px 20px", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#F8A865" }}>Delete everything</div>
            <div id="del-title" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", marginTop: 6 }}>Start Lookout from scratch?</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ border: 0, background: "rgba(255,255,255,.1)", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, lineHeight: 1, flex: "none" }}>×</button>
        </div>
        <div style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 14, lineHeight: 1.5, color: "#6B6358" }}>This permanently deletes your account and everything in it. It can’t be undone.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginBottom: 10 }}>
            {items.map((d) => (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 500 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#99220F", flex: "none" }} />
                {d}
              </div>
            ))}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "#6B6358" }}>
            <span>Type <strong style={{ color: "#1D1A0F", letterSpacing: ".06em" }}>DELETE</strong> to confirm</span>
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") close(); if (e.key === "Enter") doDelete(); }}
              placeholder="DELETE"
              className="f-brick"
              style={{ height: 42, border: `1.5px solid ${ok ? "#99220F" : "#E6E0D8"}`, background: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 14.5, letterSpacing: ".06em", outline: "none", color: "#1D1A0F" }}
            />
          </label>
          {err && <div style={{ fontSize: 13, color: "#99220F" }}>{err}</div>}
        </div>
        <div style={{ padding: "0 24px 22px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={close} style={{ height: 42, padding: "0 18px", borderRadius: 10, border: "1.5px solid #1D1A0F", background: "#fff", fontSize: 14, fontWeight: 600, color: "#1D1A0F", cursor: "pointer" }}>Cancel</button>
          <button onClick={doDelete} disabled={!ok || busy} style={{ height: 42, padding: "0 18px", borderRadius: 10, border: 0, background: ok ? "#99220F" : "#D8B0A8", fontSize: 14, fontWeight: 600, color: "#fff", cursor: ok ? "pointer" : "not-allowed" }}>
            {busy ? "Deleting…" : "Delete everything"}
          </button>
        </div>
      </div>
    </>
  );
}
