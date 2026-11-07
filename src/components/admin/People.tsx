"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../Profile";
import { btn, Row, Section, Seg } from "../Settings";
import { api } from "../store";
import { useConfirm } from "../Confirm";
import { usd, when, input, card, th, td, Tabs, Msg } from "./shared";
import type { Overview, Config } from "./shared";
import { color } from "@/lib/tokens";

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

          {data.invites.filter((i) => !i.accepted).length > 0 && (
            <Row title="Pending invites" help="Invited but not signed in yet. Resend sends a fresh link; if it keeps landing in spam, copy the link and text it to them.">
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 520 }}>
                {data.invites.filter((i) => !i.accepted).map((i) => (
                  <div key={i.email} style={{ display: "flex", flexDirection: "column", gap: 8, background: "#fff", border: "1.5px solid #E6E0D8", borderRadius: 10, padding: "8px 8px 8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>{i.email}</span>
                      <span style={{ fontSize: 14, color: color.t2 }}>{when(i.createdAt)}</span>
                      <button onClick={() => resend(i.email)} style={{ ...btn("outline"), height: 30, padding: "0 10px", fontSize: 14 }}>{data.emailEnabled ? "Resend" : "New link"}</button>
                      <button onClick={() => revoke(i.email)} className="h-danger" style={{ ...btn("danger"), height: 30, padding: "0 10px", fontSize: 14 }}>Revoke</button>
                    </div>
                    {resent[i.email] && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 14 }}>
                        <span style={{ color: "#35662A", fontWeight: 600 }}>{resent[i.email].emailed ? "Sent again with a fresh 7-day link." : "New link ready."}</span>
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
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 4, background: "#fff", border: "1.5px solid #E6E0D8", borderRadius: 10, padding: "8px 12px", fontSize: 14 }}>
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
                      <span style={{ fontSize: 14, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: u.disabled ? "#FBEDEA" : u.isAdmin ? "#FDE7D3" : "#F4F1EC", color: u.disabled ? color.brick : u.isAdmin ? "#7A3A10" : color.t2 }}>
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
                      <span data-tip={r.error ?? undefined} style={{ fontWeight: 600, color: r.status === "failed" ? color.brick : r.status === "running" ? "#7A3A10" : "#35662A" }}>
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

function Invite({ emailEnabled, onDone }: { emailEnabled: boolean; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [send, setSend] = useState(emailEnabled);
  const [res, setRes] = useState<{ link: string; email: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setErr(null);
    setCopied(false);
    try {
      const r = await api<{ link: string; email: string; emailed: boolean }>("/api/admin/invite", { method: "POST", json: { email, send } });
      setRes(r);
      setEmail("");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create the invite");
    }
  };
  return (
    <Row title="Invite someone" help="Creates their invite and a sign-in link that works once and lasts 7 days. Text it to them, or email it if email is set up.">
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="their@email.com" aria-label="Email to invite" className="f-brick" style={{ ...input, flex: 1, minWidth: 0 }} />
          <button onClick={create} style={btn("solid")}>Invite</button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: emailEnabled ? color.ink : "#A89F92" }}>
          <input type="checkbox" checked={send && emailEnabled} disabled={!emailEnabled} onChange={(e) => setSend(e.target.checked)} />
          {emailEnabled ? "Also email them the link" : "Email isn't set up yet, so copy the link and send it yourself"}
        </label>
        <Msg text={err} />
        {res && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, background: "#fff", border: "1.5px solid #E6E0D8" }}>
            <span style={{ fontSize: 14, color: color.t2 }}>
              {res.emailed ? "Emailed to " : "Sign-in link for "}
              <strong style={{ color: color.ink }}>{res.email}</strong>
            </span>
            <code style={{ fontSize: 14, wordBreak: "break-all" }}>{res.link}</code>
            <button onClick={() => navigator.clipboard?.writeText(res.link).then(() => setCopied(true)).catch(() => {})} style={{ ...btn("outline"), alignSelf: "flex-start", height: 34 }}>{copied ? "Copied" : "Copy link"}</button>
          </div>
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
          <div key={email} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, background: "#fff", border: "1.5px solid #E6E0D8" }}>
            <span style={{ fontSize: 14, color: "#35662A", fontWeight: 600 }}>{links[email].emailed ? `Approved and emailed ${email}` : `Approved ${email}. Send them this link:`}</span>
            {!links[email].emailed && (
              <>
                <code style={{ fontSize: 14, wordBreak: "break-all" }}>{links[email].link}</code>
                <button onClick={() => navigator.clipboard?.writeText(links[email].link).then(() => setCopied(email)).catch(() => {})} style={{ ...btn("outline"), alignSelf: "flex-start", height: 32, fontSize: 14 }}>{copied === email ? "Copied" : "Copy link"}</button>
              </>
            )}
          </div>
        ))}
        {pending.map((r) => (
          <div key={r.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px 10px 12px", borderRadius: 10, background: "#fff", border: "1.5px solid #E6E0D8", flexWrap: "wrap" }}>
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
