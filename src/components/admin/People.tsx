"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../Profile";
import { btn, Row, Section, Seg } from "../Settings";
import { api } from "../store";
import { useConfirm } from "../Confirm";
import { usd, when, input, card, th, td, Tabs, Msg } from "./shared";
import type { Overview, Config } from "./shared";
import { color } from "@/lib/tokens";
import { MAX_BULK, parseEmails } from "@/lib/emailList";

// --- People ---------------------------------------------------------------------

export function AdminPeople() {
  const ask = useConfirm();
  const [data, setData] = useState<Overview | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(
    () =>
      Promise.all([api<Overview>("/api/admin/overview"), api<Config>("/api/admin/settings")])
        .then(([o, c]) => {
          setData(o);
          setCfg(c);
        })
        .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load")),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const patchUser = async (id: string, p: { disabled?: boolean; isAdmin?: boolean }) => {
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", json: p });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update");
    }
  };
  const revoke = async (email: string) => {
    if (!(await ask({ eyebrow: "Revoke invite", title: `Revoke ${email}?`, body: "Their unused sign-in links stop working. If they already have an account, it stays.", confirmLabel: "Revoke", danger: true }))) return;
    try {
      await api(`/api/admin/invites/${encodeURIComponent(email)}`, { method: "DELETE" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't revoke the invite");
    }
    await load();
  };
  // Resend mints a fresh 7-day link and emails it again; the link is also shown to copy and send yourself.
  const [resent, setResent] = useState<Record<string, { link: string; emailed: boolean; copied?: boolean }>>({});
  const resend = async (email: string) => {
    try {
      const r = await api<{ link: string; emailed: boolean }>("/api/admin/invite", { method: "POST", json: { email, send: !!data?.emailEnabled } });
      setResent((m) => ({ ...m, [email]: { link: r.link, emailed: r.emailed } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't resend");
    }
  };
  const copyResent = (email: string) =>
    navigator.clipboard?.writeText(resent[email].link).then(() => setResent((m) => ({ ...m, [email]: { ...m[email], copied: true } }))).catch(() => {});
  const saveAccess = async (access: Config["access"]) => {
    if (!cfg) return;
    setCfg({ ...cfg, access });
    await api("/api/admin/settings", { method: "PUT", json: { access } }).catch((e) => setErr(e.message));
  };

  return (
    <div className="page-pad settings lk-page" style={{ display: "flex", flexDirection: "column", maxWidth: 1100, gap: 4 }}>
      <PageHead eyebrow="Admin" title="People and activity" intro="Who's using Lookout, what it costs, and who gets in.">
        <Tabs />
      </PageHead>
      <Msg text={err} />
      {data && cfg && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginTop: 14 }}>
            {[["People", String(data.totals.users)], ["Spend, 24 hours", usd(data.totals.usdDay)], ["Spend, 7 days", usd(data.totals.usdWeek)], ["Spend, 30 days", usd(data.totals.usdMonth)]].map(([k, v]) => (
              <div key={k} style={card}>
                <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: color.t2 }}>{k}</div>
                <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{v}</div>
              </div>
            ))}
          </div>

          <Section>Access</Section>
          <Row title="Who can sign up" help={cfg.access.signupMode === "invite" ? "Only people you invite (and existing accounts) can get in." : "Anyone with an email address can create an account. Their searches spend your budget."}>
            <Seg opts={[["Invite only", "invite"], ["Open", "open"]]} cur={cfg.access.signupMode} pick={(v) => saveAccess({ ...cfg.access, signupMode: v as "open" | "invite" })} />
          </Row>
          <Row title="Daily spend caps" help="Rolling 24 hours. New searches stop when either cap is reached.">
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <MoneyInput label="All users" value={cfg.access.dailyBudgetUsd} onSave={(v) => saveAccess({ ...cfg.access, dailyBudgetUsd: v })} />
              <MoneyInput label="Per user" value={cfg.access.userDailyBudgetUsd} onSave={(v) => saveAccess({ ...cfg.access, userDailyBudgetUsd: v })} />
            </div>
          </Row>
          <Requests requests={data.requests} emailEnabled={data.emailEnabled} onDone={load} />
          <Invite emailEnabled={data.emailEnabled} onDone={load} />
          <GroupLinks />

          {data.invites.filter((i) => !i.accepted).length > 0 && (
            <Row title="Pending invites" help="Invited but not signed in yet. Resend sends a fresh link; if it keeps landing in spam, copy the link and text it to them.">
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 520 }}>
                {data.invites.filter((i) => !i.accepted).map((i) => (
                  <div key={i.email} style={{ display: "flex", flexDirection: "column", gap: 8, background: "#fff", border: `1.5px solid ${color.border}`, borderRadius: 10, padding: "8px 8px 8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>{i.email}</span>
                      <span style={{ fontSize: 14, color: color.t2 }}>{when(i.createdAt)}</span>
                      <button onClick={() => resend(i.email)} style={{ ...btn("outline"), height: 30, padding: "0 10px", fontSize: 14 }}>{data.emailEnabled ? "Resend" : "New link"}</button>
                      <button onClick={() => revoke(i.email)} className="h-danger" style={{ ...btn("danger"), height: 30, padding: "0 10px", fontSize: 14 }}>Revoke</button>
                    </div>
                    {resent[i.email] && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 14 }}>
                        <span style={{ color: color.greenText, fontWeight: 600 }}>{resent[i.email].emailed ? "Sent again with a fresh 7-day link." : "New link ready."}</span>
                        <button onClick={() => copyResent(i.email)} style={{ ...btn("text"), height: 26, fontSize: 14 }}>{resent[i.email].copied ? "Copied" : "Copy link to send yourself"}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Row>
          )}

          {data.inbox.length > 0 && (
            <Row title="Inbox" help="Email sent to any address at lookout.ericdevlin.co. The inbox agent reads each one and drafts a reply; nothing is sent without you.">
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 640 }}>
                {data.inbox.map((m) => (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 4, background: "#fff", border: `1.5px solid ${color.border}`, borderRadius: 10, padding: "8px 12px", fontSize: 14 }}>
                    <div style={{ display: "flex", gap: 10 }}>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subject || "(no subject)"}</span>
                      <span style={{ color: color.t2 }}>{when(m.receivedAt)}</span>
                    </div>
                    <span style={{ color: color.t2, overflow: "hidden", textOverflow: "ellipsis" }}>{m.from}{m.triage ? ` · ${m.triage.kind}` : " · not read yet"}</span>
                    {m.triage && <span>{m.triage.summary}</span>}
                  </div>
                ))}
              </div>
            </Row>
          )}

          <Section>People</Section>
          <div style={{ ...card, padding: 0, overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr>{["Person", "Joined", "Last sign-in", "Finds", "Searches (30d)", "Spend (30d)", "Access", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{u.name || "No name yet"}</div>
                      <div style={{ color: color.t2, fontSize: 14 }}>{u.email}</div>
                    </td>
                    <td style={td}>{when(u.createdAt)}</td>
                    <td style={td}>{when(u.lastLoginAt)}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{u.finds}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{u.runs30}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{usd(u.usd30)}</td>
                    <td style={td}>
                      <span style={{ fontSize: 14, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: u.disabled ? "#FBEDEA" : u.isAdmin ? "#FDE7D3" : color.surface, color: u.disabled ? color.brick : u.isAdmin ? "#7A3A10" : color.t2 }}>
                        {u.disabled ? "Disabled" : u.isAdmin ? "Admin" : "Member"}
                      </span>
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                      <a href={`/view/${u.id}`} style={{ ...btn("outline"), height: 30, padding: "0 10px", fontSize: 14, marginRight: 6, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>View board</a>
                      <button onClick={() => patchUser(u.id, { isAdmin: !u.isAdmin })} style={{ ...btn("outline"), height: 30, padding: "0 10px", fontSize: 14, marginRight: 6 }}>{u.isAdmin ? "Remove admin" : "Make admin"}</button>
                      <button onClick={async () => (u.disabled || (await ask({ eyebrow: "Disable account", title: `Disable ${u.email}?`, body: "They're signed out everywhere and can't sign back in until you enable them. Their board and data stay.", confirmLabel: "Disable", danger: true }))) && patchUser(u.id, { disabled: !u.disabled })} className="h-danger" style={{ ...btn("danger"), height: 30, padding: "0 10px", fontSize: 14 }}>{u.disabled ? "Enable" : "Disable"}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Section>Recent searches</Section>
          <div style={{ ...card, padding: 0, overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr>{["When", "Who", "Type", "Result", "Found / added", "Web searches", "Cost"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.runs.length === 0 && (
                  <tr><td style={{ ...td, color: color.t2 }} colSpan={7}>No searches yet.</td></tr>
                )}
                {data.runs.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{when(r.startedAt)}</td>
                    <td style={td}>{r.email}</td>
                    <td style={td}>{({ scheduled: "Scheduled", manual: "Search now", url: "Added link", resume: "Resume scan" } as Record<string, string>)[r.trigger] ?? r.trigger}</td>
                    <td style={td}>
                      <span data-tip={r.error ?? undefined} style={{ fontWeight: 600, color: r.status === "failed" ? color.brick : r.status === "running" ? "#7A3A10" : color.greenText }}>
                        {r.status === "failed" ? "Failed" : r.status === "running" ? "Running" : "Done"}
                      </span>
                      {r.error && <div style={{ fontSize: 14, color: color.t2, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.error}</div>}
                    </td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.found} / {r.added}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.searches}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{usd(r.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function MoneyInput({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  const commit = () => {
    const n = Number(v.replace(/[$,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(n);
    else setV(String(value));
  };
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: color.t2 }}>
      {label}
      <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="f-brick" style={{ ...input, width: 140, textTransform: "none", letterSpacing: 0, fontWeight: 500 }} />
    </label>
  );
}

type InviteResult = { email: string; link: string; emailed: boolean } | { email: string; error: string };

function Invite({ emailEnabled, onDone }: { emailEnabled: boolean; onDone: () => void }) {
  const [text, setText] = useState("");
  const [send, setSend] = useState(emailEnabled);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<InviteResult[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { ok, bad } = parseEmails(text);
  const create = async () => {
    setErr(null);
    setCopied(null);
    if (!ok.length) return setErr(bad.length ? `Not an email address: ${bad.join(", ")}` : "Paste one or more email addresses.");
    if (ok.length > MAX_BULK) return setErr(`Up to ${MAX_BULK} people at a time.`);
    setBusy(true);
    try {
      const r = await api<{ results: InviteResult[] }>("/api/admin/invite", { method: "POST", json: { emails: ok, send: send && emailEnabled } });
      setRes(r.results);
      setText(bad.join(", "));
      if (bad.length) setErr(`Skipped, not email addresses: ${bad.join(", ")}`);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create the invites");
    } finally {
      setBusy(false);
    }
  };
  const copy = (key: string, value: string) => navigator.clipboard?.writeText(value).then(() => setCopied(key)).catch(() => {});
  const links = (res ?? []).filter((r): r is Extract<InviteResult, { link: string }> => "link" in r);
  return (
    <Row title="Invite people" help="Paste one email or a whole list. Each person gets an invite and a sign-in link that works once and lasts 7 days. Text the links, or email them if email is set up.">
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && create()} placeholder={"ana@example.com, bo@example.com\nor one per line"} aria-label="Emails to invite" rows={3} className="f-brick" style={{ ...input, maxWidth: "none", height: "auto", minHeight: 76, padding: "10px 13px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.45 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={create} disabled={busy || !ok.length} style={{ ...btn("solid"), opacity: busy || !ok.length ? 0.6 : 1 }}>
            {busy ? "Inviting..." : ok.length > 1 ? `Invite ${ok.length} people` : "Invite"}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: emailEnabled ? color.ink : "#A89F92" }}>
            <input type="checkbox" checked={send && emailEnabled} disabled={!emailEnabled} onChange={(e) => setSend(e.target.checked)} />
            {emailEnabled ? "Also email them the link" : "Email isn't set up yet, so copy the links and send them yourself"}
          </label>
        </div>
        <Msg text={err} />
        {res && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, background: "#fff", border: `1.5px solid ${color.border}` }}>
            {res.map((r) => (
              <div key={r.email} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 14 }}>
                <strong style={{ flex: 1, minWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{r.email}</strong>
                {"error" in r ? (
                  <span style={{ color: color.brick }}>{r.error}</span>
                ) : (
                  <>
                    <span style={{ color: color.greenText, fontWeight: 600 }}>{r.emailed ? "Emailed" : "Link ready"}</span>
                    <button onClick={() => copy(r.email, r.link)} style={{ ...btn("outline"), height: 30, padding: "0 10px", fontSize: 14 }}>{copied === r.email ? "Copied" : "Copy link"}</button>
                  </>
                )}
              </div>
            ))}
            {links.length > 1 && (
              <button onClick={() => copy("*", links.map((r) => `${r.email}: ${r.link}`).join("\n"))} style={{ ...btn("text"), alignSelf: "flex-start", height: 26, fontSize: 14 }}>{copied === "*" ? "Copied all" : "Copy all links"}</button>
            )}
          </div>
        )}
      </div>
    </Row>
  );
}

type Group = { code: string; label: string; link: string; max: number; used: string[]; createdAt: string; expiresAt: string; closedAt?: string; state: "open" | "closed" | "expired" | "full" };

/** Group links (#993): one link a class or meetup can use to make accounts. Was a script over SSH. */
function GroupLinks() {
  const ask = useConfirm();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [label, setLabel] = useState("");
  const [max, setMax] = useState("20");
  const [days, setDays] = useState("7");
  const [code, setCode] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(
    () => api<{ groups: Group[] }>("/api/admin/group-invites").then((r) => setGroups(r.groups)).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load group links")),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const copy = (key: string, value: string) => navigator.clipboard?.writeText(value).then(() => setCopied(key)).catch(() => {});
  const create = async () => {
    setErr(null);
    const m = Math.floor(Number(max));
    const d = Math.floor(Number(days));
    if (!label.trim()) return setErr("Give the link a name, like the class or event.");
    if (!(m >= 1 && m <= 500)) return setErr("People: 1 to 500.");
    if (!(d >= 1 && d <= 90)) return setErr("Days: 1 to 90.");
    setBusy(true);
    try {
      const g = await api<Group>("/api/admin/group-invites", { method: "POST", json: { label: label.trim(), max: m, days: d, ...(code.trim() ? { code: code.trim().toLowerCase() } : {}) } });
      setMade(g.code);
      setLabel("");
      setCode("");
      await load();
      copy(g.code, g.link);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't make the link");
    } finally {
      setBusy(false);
    }
  };
  const close = async (g: Group) => {
    if (!(await ask({ eyebrow: "Close group link", title: `Close ${g.label}?`, body: "Nobody new can join with it. The people who already made accounts keep them.", confirmLabel: "Close link", danger: true }))) return;
    try {
      await api(`/api/admin/group-invites/${encodeURIComponent(g.code)}`, { method: "DELETE" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't close the link");
    }
    await load();
  };
  const open = (groups ?? []).filter((g) => g.state === "open");
  const old = (groups ?? []).filter((g) => g.state !== "open");
  const shown = showAll ? [...open, ...old] : open;
  const stateLabel = { open: "Open", closed: "Closed", expired: "Expired", full: "Full" } as const;
  const small = { ...input, width: 90, height: 38 };
  return (
    <Row title="Group links" help="One link a whole class or meetup can use to make accounts, until it fills up, expires or you close it. Copy it and text it to the group.">
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 620 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="Tuesday spin class" aria-label="Group link name" maxLength={80} className="f-brick" style={{ ...input, flex: 1, minWidth: 180, height: 38 }} />
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, fontWeight: 600, color: color.t2 }}>
            People
            <input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Most people" className="f-brick" style={small} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, fontWeight: 600, color: color.t2 }}>
            Days
            <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days it lasts" className="f-brick" style={small} />
          </label>
          <button onClick={create} disabled={busy} style={{ ...btn("solid"), height: 38, opacity: busy ? 0.6 : 1 }}>{busy ? "Making..." : "Make link"}</button>
        </div>
        {more ? (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: color.t2 }}>
            Code in the link (optional)
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="spin-tuesday" aria-label="Code in the link" maxLength={40} className="f-brick" style={{ ...input, width: 200, height: 34 }} />
          </label>
        ) : (
          <button onClick={() => setMore(true)} style={{ ...btn("text"), alignSelf: "flex-start", height: 24, fontSize: 14 }}>Pick the code in the link</button>
        )}
        <Msg text={err} />
        {groups && !groups.length && <span style={{ fontSize: 14, color: color.t2 }}>No group links yet.</span>}
        {shown.map((g) => (
          <div key={g.code} style={{ display: "flex", flexDirection: "column", gap: 6, background: "#fff", border: `1.5px solid ${made === g.code ? color.greenText : color.border}`, borderRadius: 10, padding: "10px 10px 10px 12px", opacity: g.state === "open" ? 1 : 0.7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: 1, minWidth: 140, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{g.label}</span>
              <span style={{ fontSize: 14, color: color.t2, fontVariantNumeric: "tabular-nums" }}>{g.used.length}/{g.max} joined</span>
              <span style={{ fontSize: 14, color: g.state === "open" ? color.t2 : color.brick }}>{g.state === "open" ? `Until ${when(g.expiresAt)}` : stateLabel[g.state]}</span>
              {g.state === "open" && (
                <>
                  <button onClick={() => copy(g.code, g.link)} style={{ ...btn("outline"), height: 30, padding: "0 10px", fontSize: 14 }}>{copied === g.code ? "Copied" : "Copy link"}</button>
                  <button onClick={() => close(g)} className="h-danger" style={{ ...btn("danger"), height: 30, padding: "0 10px", fontSize: 14 }}>Close</button>
                </>
              )}
            </div>
            <code style={{ fontSize: 13, color: color.t2, wordBreak: "break-all" }}>{g.link}</code>
            {made === g.code && <span style={{ fontSize: 14, color: color.greenText, fontWeight: 600 }}>{copied === g.code ? "Made and copied." : "Made."}</span>}
            {g.used.length > 0 && (
              <details style={{ fontSize: 14, color: color.t2 }}>
                <summary style={{ cursor: "pointer" }}>Who joined</summary>
                <div style={{ marginTop: 4 }}>{g.used.join(", ")}</div>
              </details>
            )}
          </div>
        ))}
        {old.length > 0 && (
          <button onClick={() => setShowAll((v) => !v)} style={{ ...btn("text"), alignSelf: "flex-start", height: 24, fontSize: 14 }}>
            {showAll ? "Hide closed and expired" : `Show closed and expired (${old.length})`}
          </button>
        )}
      </div>
    </Row>
  );
}

function Requests({ requests, emailEnabled, onDone }: { requests: Overview["requests"]; emailEnabled: boolean; onDone: () => void }) {
  const [links, setLinks] = useState<Record<string, { link: string; emailed: boolean }>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (email: string, decision: "approve" | "decline") => {
    setErr(null);
    try {
      const r = await api<{ link?: string; emailed?: boolean }>(`/api/admin/requests/${encodeURIComponent(email)}`, { method: "POST", json: { decision, send: emailEnabled } });
      if (decision === "approve" && r.link) setLinks((l) => ({ ...l, [email]: { link: r.link!, emailed: !!r.emailed } }));
      else onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save that");
    }
  };
  const approved = Object.keys(links);
  const pending = requests.filter((r) => !links[r.email]);
  if (!pending.length && !approved.length) {
    return (
      <Row title="Access requests" help="People who asked to join from the sign-in page.">
        <span style={{ fontSize: 14, color: color.t2 }}>No requests waiting.</span>
      </Row>
    );
  }
  return (
    <Row title="Access requests" help={emailEnabled ? "Approving emails them an invite." : "Approving creates an invite link to send them yourself, since email isn't set up yet."}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 520 }}>
        <Msg text={err} />
        {approved.map((email) => (
          <div key={email} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, background: "#fff", border: `1.5px solid ${color.border}` }}>
            <span style={{ fontSize: 14, color: color.greenText, fontWeight: 600 }}>{links[email].emailed ? `Approved and emailed ${email}` : `Approved ${email}. Send them this link:`}</span>
            {!links[email].emailed && (
              <>
                <code style={{ fontSize: 14, wordBreak: "break-all" }}>{links[email].link}</code>
                <button onClick={() => navigator.clipboard?.writeText(links[email].link).then(() => setCopied(email)).catch(() => {})} style={{ ...btn("outline"), alignSelf: "flex-start", height: 32, fontSize: 14 }}>{copied === email ? "Copied" : "Copy link"}</button>
              </>
            )}
          </div>
        ))}
        {pending.map((r) => (
          <div key={r.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px 10px 12px", borderRadius: 10, background: "#fff", border: `1.5px solid ${color.border}`, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{r.email}</div>
              <div style={{ fontSize: 14, color: color.t2 }}>{r.nextMove ?? "No answer"} · {when(r.createdAt)}</div>
            </div>
            <button onClick={() => decide(r.email, "decline")} className="h-danger" style={{ ...btn("danger"), height: 32, padding: "0 12px", fontSize: 14 }}>Decline</button>
            <button onClick={() => decide(r.email, "approve")} style={{ ...btn("solid"), height: 32, padding: "0 12px", fontSize: 14 }}>Approve</button>
          </div>
        ))}
      </div>
    </Row>
  );
}
