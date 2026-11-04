"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead } from "./Profile";
import { btn, Row, Section, Seg } from "./Settings";
import { api } from "./store";
import { useConfirm } from "./Confirm";

type Overview = {
  inbox: { id: string; from: string; subject: string; receivedAt: string; status: string; triage: { kind: string; summary: string; draftReply?: string | null } | null }[];
  requests: { email: string; nextMove: string | null; createdAt: string }[];
  totals: { users: number; usdDay: number; usdWeek: number; usdMonth: number };
  emailEnabled: boolean;
  users: {
    id: string; email: string; name: string; isAdmin: boolean; disabled: boolean; createdAt: string;
    lastLoginAt: string | null; finds: number; runs30: number; usd30: number; lastRunAt: string | null;
  }[];
  invites: { email: string; createdAt: string; accepted: boolean }[];
  runs: {
    id: string; email: string; trigger: string; status: string; startedAt: string; finishedAt: string | null;
    found: number; added: number; searches: number; costUsd: number; error: string | null;
  }[];
};

type Config = {
  agent: { tokenSet: boolean; lastSeen: string | null };
  ai: { provider: "openai" | "anthropic" | "agent"; baseUrl: string; model: string; apiKey: string; apiKeyHint: string; priceIn: number; priceOut: number; jsonMode: "schema" | "object"; privacy: "strict" | "standard" };
  search: { provider: "searxng" | "brave" | "none"; searxngUrl: string; braveKey: string; braveKeyHint: string; pricePerQuery: number };
  access: { signupMode: "open" | "invite"; dailyBudgetUsd: number; userDailyBudgetUsd: number };
};

const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never";
const input: React.CSSProperties = { width: "100%", maxWidth: 420, height: 42, border: "1.5px solid #E6E0D8", background: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 14, outline: "none", color: "#1D1A0F" };
const card: React.CSSProperties = { background: "#fff", borderRadius: 16, padding: "16px 18px" };
const th: React.CSSProperties = { fontSize: 14, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#6B6358", textAlign: "left", padding: "12px 14px", borderBottom: "1px solid #EEEAE4", whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 14, padding: "12px 14px", borderBottom: "1px solid #F2EEE8", verticalAlign: "top" };

export function Tabs() {
  const path = usePathname();
  const tabs = [["/admin", "People"], ["/admin/ai", "AI settings"], ["/admin/surveys", "Surveys"], ["/admin/quality", "Finds quality"]] as const;
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
      {tabs.map(([href, label]) => {
        const on = path === href;
        return (
          <Link key={href} href={href} style={{ display: "flex", alignItems: "center", height: 34, padding: "0 15px", borderRadius: 999, border: `1.5px solid ${on ? "#99220F" : "#E0D9CF"}`, background: on ? "#99220F" : "#fff", color: on ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}

function Msg({ text, ok }: { text: string | null; ok?: boolean }) {
  if (!text) return null;
  return <div aria-live="polite" style={{ fontSize: 14, color: ok ? "#35662A" : "#99220F", lineHeight: 1.45 }}>{text}</div>;
}

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
                <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#6B6358" }}>{k}</div>
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
                      <span style={{ fontSize: 14, color: "#6B6358" }}>{when(i.createdAt)}</span>
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
                      <span style={{ color: "#6B6358" }}>{when(m.receivedAt)}</span>
                    </div>
                    <span style={{ color: "#6B6358", overflow: "hidden", textOverflow: "ellipsis" }}>{m.from}{m.triage ? ` · ${m.triage.kind}` : " · not read yet"}</span>
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
                      <div style={{ color: "#6B6358", fontSize: 14 }}>{u.email}</div>
                    </td>
                    <td style={td}>{when(u.createdAt)}</td>
                    <td style={td}>{when(u.lastLoginAt)}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{u.finds}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{u.runs30}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{usd(u.usd30)}</td>
                    <td style={td}>
                      <span style={{ fontSize: 14, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: u.disabled ? "#FBEDEA" : u.isAdmin ? "#FDE7D3" : "#F4F1EC", color: u.disabled ? "#99220F" : u.isAdmin ? "#7A3A10" : "#6B6358" }}>
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
                  <tr><td style={{ ...td, color: "#6B6358" }} colSpan={7}>No searches yet.</td></tr>
                )}
                {data.runs.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{when(r.startedAt)}</td>
                    <td style={td}>{r.email}</td>
                    <td style={td}>{({ scheduled: "Scheduled", manual: "Search now", url: "Added link", resume: "Resume scan" } as Record<string, string>)[r.trigger] ?? r.trigger}</td>
                    <td style={td}>
                      <span data-tip={r.error ?? undefined} style={{ fontWeight: 600, color: r.status === "failed" ? "#99220F" : r.status === "running" ? "#7A3A10" : "#35662A" }}>
                        {r.status === "failed" ? "Failed" : r.status === "running" ? "Running" : "Done"}
                      </span>
                      {r.error && <div style={{ fontSize: 14, color: "#6B6358", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.error}</div>}
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
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#6B6358" }}>
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
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: emailEnabled ? "#1D1A0F" : "#A89F92" }}>
          <input type="checkbox" checked={send && emailEnabled} disabled={!emailEnabled} onChange={(e) => setSend(e.target.checked)} />
          {emailEnabled ? "Also email them the link" : "Email isn't set up yet, so copy the link and send it yourself"}
        </label>
        <Msg text={err} />
        {res && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, background: "#fff", border: "1.5px solid #E6E0D8" }}>
            <span style={{ fontSize: 14, color: "#6B6358" }}>
              {res.emailed ? "Emailed to " : "Sign-in link for "}
              <strong style={{ color: "#1D1A0F" }}>{res.email}</strong>
            </span>
            <code style={{ fontSize: 14, wordBreak: "break-all" }}>{res.link}</code>
            <button onClick={() => navigator.clipboard?.writeText(res.link).then(() => setCopied(true)).catch(() => {})} style={{ ...btn("outline"), alignSelf: "flex-start", height: 34 }}>{copied ? "Copied" : "Copy link"}</button>
          </div>
        )}
      </div>
    </Row>
  );
}

// --- AI settings --------------------------------------------------------------------

type Catalog = "openrouter" | "opencode" | "opencode-go";
type Preset = { label: string; url: string; catalog?: Catalog; editableUrl?: boolean; pricing?: string };
// A preset fixes the address. Ollama stays editable because its host differs per setup.
const PRESETS: Preset[] = [
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1", catalog: "openrouter" },
  { label: "OpenCode Zen", url: "https://opencode.ai/zen/v1", catalog: "opencode", pricing: "https://opencode.ai/docs/zen/" },
  { label: "OpenCode Go", url: "https://opencode.ai/zen/go/v1", catalog: "opencode-go", pricing: "https://opencode.ai/docs/zen/" },
  { label: "DeepInfra", url: "https://api.deepinfra.com/v1/openai", pricing: "https://deepinfra.com/pricing" },
  { label: "Together", url: "https://api.together.xyz/v1", pricing: "https://www.together.ai/pricing" },
  { label: "Groq", url: "https://api.groq.com/openai/v1", pricing: "https://groq.com/pricing" },
  { label: "Ollama (local)", url: "http://host.docker.internal:11434/v1", editableUrl: true },
];
const CATALOG_NAME: Record<Catalog, string> = { openrouter: "OpenRouter", opencode: "OpenCode Zen", "opencode-go": "OpenCode Go" };

function Fixed({ children, empty }: { children: React.ReactNode; empty?: boolean }) {
  return (
    <div style={{ ...input, display: "flex", alignItems: "center", background: "#F6F2EC", borderColor: "#EEEAE4", color: empty ? "#6B6358" : "#1D1A0F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</div>
  );
}

type Part = "ai" | "search";
const TYPING = 800;
function withoutHint<T extends object, K extends keyof T>(o: T, k: K): Omit<T, K> {
  const { [k]: _drop, ...rest } = o;
  void _drop;
  return rest;
}

export function AdminAi() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [aiMsg, setAiMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [searchMsg, setSearchMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [fetchUrl, setFetchUrl] = useState("");
  const [fetchMsg, setFetchMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // Bumped when the picker fills prices, so the price fields show the new values.
  const [picked, setPicked] = useState(0);
  const [custom, setCustom] = useState(false);

  // Every change saves itself: picks right away, typing after a short pause.
  const latest = useRef<Config | null>(null);
  const timers = useRef<Partial<Record<Part, ReturnType<typeof setTimeout>>>>({});
  useEffect(() => { latest.current = cfg; }, [cfg]);
  const persist = useCallback(async (part: Part) => {
    delete timers.current[part];
    const cur = latest.current;
    if (!cur) return;
    const set = part === "ai" ? setAiMsg : setSearchMsg;
    const url = part === "ai" ? cur.ai.baseUrl : cur.search.searxngUrl;
    if (!/^https?:\/\/[^/\s]+/.test(url)) return set({ text: "Not saved yet: the address needs to start with https://", ok: false });
    const sentKey = part === "ai" ? cur.ai.apiKey : cur.search.braveKey;
    const sent = part === "ai" ? withoutHint(cur.ai, "apiKeyHint") : withoutHint(cur.search, "braveKeyHint");
    set({ text: "Saving…", ok: true });
    try {
      const next = await api<Config>("/api/admin/settings", { method: "PUT", json: { [part]: sent } });
      // Keep anything typed since; take the new key hint and clear a key that was just stored.
      setCfg((c) => {
        if (!c) return c;
        if (part === "ai") return { ...c, ai: { ...c.ai, apiKeyHint: next.ai.apiKeyHint, apiKey: c.ai.apiKey === sentKey ? "" : c.ai.apiKey } };
        return { ...c, search: { ...c.search, braveKeyHint: next.search.braveKeyHint, braveKey: c.search.braveKey === sentKey ? "" : c.search.braveKey } };
      });
      set({ text: "Saved", ok: true });
    } catch (e) {
      set({ text: `Not saved: ${e instanceof Error ? e.message : "try again"}`, ok: false });
    }
  }, []);
  const schedule = useCallback((part: Part, delay: number) => {
    clearTimeout(timers.current[part]);
    timers.current[part] = setTimeout(() => void persist(part), delay);
  }, [persist]);
  // Leaving the page mid-pause still saves.
  useEffect(() => () => {
    for (const part of Object.keys(timers.current) as Part[]) {
      clearTimeout(timers.current[part]);
      void persist(part);
    }
  }, [persist]);

  useEffect(() => {
    api<Config>("/api/admin/settings").then(setCfg).catch((e) => setAiMsg({ text: e.message, ok: false }));
  }, []);
  if (!cfg) return <div className="page-pad lk-page"><PageHead eyebrow="Admin" title="AI settings"><Tabs /></PageHead>{aiMsg && <Msg text={aiMsg.text} />}</div>;

  const ai = cfg.ai, search = cfg.search;
  const preset = custom ? undefined : PRESETS.find((p) => p.url === ai.baseUrl);
  const catalog = ai.provider === "openai" ? preset?.catalog : undefined;
  const choosePreset = (p: Preset | null) => {
    setCustom(!p);
    if (!p || p.url === ai.baseUrl) return;
    // A model ID from one provider rarely exists on another, so start the pick over.
    setAi({ baseUrl: p.url, model: "", priceIn: 0, priceOut: 0, jsonMode: "schema" });
    setPicked((n) => n + 1);
  };
  // The ref is updated here too, so a save that fires before the next render still sends this edit.
  const setAi = (p: Partial<Config["ai"]>, delay = 0) => {
    const base = latest.current ?? cfg;
    latest.current = { ...base, ai: { ...base.ai, ...p } };
    setCfg(latest.current);
    schedule("ai", delay);
  };
  const setSearch = (p: Partial<Config["search"]>, delay = 0) => {
    const base = latest.current ?? cfg;
    latest.current = { ...base, search: { ...base.search, ...p } };
    setCfg(latest.current);
    schedule("search", delay);
  };
  const aiBody = () => withoutHint(ai, "apiKeyHint");
  const searchBody = () => withoutHint(search, "braveKeyHint");

  const test = async (section: "ai" | "search") => {
    const set = section === "ai" ? setAiMsg : setSearchMsg;
    set({ text: "Testing…", ok: true });
    type T = { ok: boolean; error?: string; ms?: number; sample?: string; count?: number };
    const r: T = await api<T>("/api/admin/settings/test", {
      method: "POST",
      json: section === "ai" ? { section, values: aiBody() } : { section, values: searchBody() },
    }).catch((e): T => ({ ok: false, error: e.message as string }));
    if (!r.ok) return set({ text: `Didn't work: ${r.error ?? "no result"}`, ok: false });
    set({
      text: section === "ai" ? `Works. Answered "${r.sample}" in ${((r.ms ?? 0) / 1000).toFixed(1)}s.` : `Works. ${r.count} results in ${((r.ms ?? 0) / 1000).toFixed(1)}s, e.g. ${r.sample}`,
      ok: true,
    });
  };
  const searchTest = <button onClick={() => test("search")} style={{ ...btn("text"), height: 42, flex: "none" }}>Test</button>;
  const testFetch = async () => {
    setFetchMsg({ text: "Fetching…", ok: true });
    type F = { ok: boolean; error?: string; chars?: number; ms?: number };
    const r: F = await api<F>("/api/admin/settings/test", { method: "POST", json: { section: "fetch", url: fetchUrl } }).catch((e): F => ({ ok: false, error: e.message as string }));
    setFetchMsg(r.ok ? { text: `Read ${r.chars} characters in ${((r.ms ?? 0) / 1000).toFixed(1)}s.`, ok: true } : { text: `Couldn't read it: ${r.error}`, ok: false });
  };

  return (
    <div className="page-pad settings lk-page" style={{ display: "flex", flexDirection: "column", maxWidth: 820 }}>
      <PageHead eyebrow="Admin" title="AI settings" intro="The model that writes queries, reads postings and scores them, and the search engine it uses. Changes save as you go. Keys are stored encrypted and never shown again.">
        <Tabs />
      </PageHead>

      <Section>Model</Section>
      <Row title="Provider" help="Any OpenAI-compatible API works: OpenRouter, DeepInfra, Together, Groq, or your own Ollama or vLLM server.">
        <Seg opts={[["OpenAI-compatible", "openai"], ["Anthropic", "anthropic"], ["Claude agent", "agent"]]} cur={ai.provider} pick={(v) => setAi({ provider: v as Config["ai"]["provider"] })} />
      </Row>
      {ai.provider === "agent" && (
        <Row title="Claude agent" help="Searches, link adds and resume reads are queued here. A poller on your Mac checks the queue every 2 minutes and has Claude Code do the work on your Claude plan, then sends results back. Nothing runs while your Mac is asleep.">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
            <span style={{ fontWeight: 600, color: cfg.agent.tokenSet ? "#35662A" : "#99220F" }}>{cfg.agent.tokenSet ? "Agent token is set on the server" : "No AGENT_TOKEN on the server yet"}</span>
            <span style={{ color: "#6B6358" }}>{cfg.agent.lastSeen ? `Agent last checked in ${when(cfg.agent.lastSeen)}` : "The agent hasn't checked in yet"}</span>
          </div>
        </Row>
      )}
      {ai.provider === "openai" && (
        <Row title="API address" help={preset && !preset.editableUrl ? `Set by ${preset.label}.` : "The base URL, ending before /chat/completions."}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[...PRESETS, null].map((p) => {
                const on = p ? preset === p : !preset;
                return (
                  <button key={p?.label ?? "custom"} onClick={() => choosePreset(p)} style={{ height: 30, padding: "0 11px", borderRadius: 999, border: `1.5px solid ${on ? "#1D1A0F" : "#E0D9CF"}`, background: on ? "#1D1A0F" : "#fff", color: on ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{p?.label ?? "Custom"}</button>
                );
              })}
            </div>
            {preset && !preset.editableUrl ? (
              <Fixed>{ai.baseUrl}</Fixed>
            ) : (
              <input value={ai.baseUrl} onChange={(e) => setAi({ baseUrl: e.target.value }, TYPING)} placeholder="https://..." aria-label="API address" className="f-brick" style={input} />
            )}
          </div>
        </Row>
      )}
      {ai.provider !== "agent" && (
        <>
      <Row title="Model" help={catalog ? `Pick from ${CATALOG_NAME[catalog]}'s list.` : ai.provider === "openai" ? "The model ID exactly as your provider writes it, e.g. a Qwen, DeepSeek or Llama model." : "e.g. claude-sonnet-5-5"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {catalog ? (
            <>
              <Fixed empty={!ai.model}>{ai.model || "No model picked yet"}</Fixed>
              <ModelPicker
                key={catalog}
                source={catalog}
                current={ai.model}
                onPick={(m) => {
                  setAi(
                    m.priceIn === null || m.priceOut === null
                      ? { model: m.id }
                      : { model: m.id, priceIn: m.priceIn, priceOut: m.priceOut, jsonMode: m.structured ? "schema" : "object" },
                  );
                  setPicked((n) => n + 1);
                }}
              />
            </>
          ) : (
            <input value={ai.model} onChange={(e) => setAi({ model: e.target.value }, TYPING)} placeholder="provider/model-name" aria-label="Model" className="f-brick" style={input} />
          )}
        </div>
      </Row>
      <Row title="API key" help={ai.apiKeyHint ? "Saved and encrypted. Replace it to use a different key." : "Not set. Local servers like Ollama don't need one."}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SecretField label="API key" hint={ai.apiKeyHint} value={ai.apiKey} onChange={(v) => setAi({ apiKey: v }, TYPING)} action={<button onClick={() => test("ai")} style={{ ...btn("text"), height: 42, flex: "none" }}>Test</button>} />
          {aiMsg && <Msg text={aiMsg.text} ok={aiMsg.ok} />}
        </div>
      </Row>
      {catalog === "openrouter" ? (
        <Row title="Price" help="Dollars per million tokens, from OpenRouter's list. Used for the spend totals and the daily caps.">
          <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{ai.model ? `$${ai.priceIn} in · $${ai.priceOut} out` : "Set when you pick a model"}</span>
        </Row>
      ) : (
        <Row
          title="Price"
          help={
            <>
              Dollars per million tokens. {catalog === "opencode-go" ? <>Go is a flat monthly plan, but its usage limits are counted in dollars at <a href={preset?.pricing} target="_blank" rel="noreferrer">Zen&apos;s rates</a>. Enter those so the spend totals track your plan limit.</> : preset?.pricing ? <>{preset.label} doesn&apos;t publish prices to apps, so copy them from <a href={preset.pricing} target="_blank" rel="noreferrer">its pricing page</a>.</> : "Copy them from your provider's model page."} Used for the spend totals and the daily caps.
            </>
          }
        >
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <NumberField key={`in-${picked}`} label="Input" value={ai.priceIn} onChange={(v) => setAi({ priceIn: v }, TYPING)} />
            <NumberField key={`out-${picked}`} label="Output" value={ai.priceOut} onChange={(v) => setAi({ priceOut: v }, TYPING)} />
          </div>
        </Row>
      )}
      {catalog === "openrouter" && (
        <Row title="Data privacy" help="Resumes and profiles go to whichever company hosts the model. Strict uses only hosts that keep nothing and don't train on it, US hosts first. Standard allows any host and may be cheaper.">
          <Seg opts={[["Strict (recommended)", "strict"], ["Standard", "standard"]]} cur={ai.privacy ?? "strict"} pick={(v) => setAi({ privacy: v as Config["ai"]["privacy"] })} />
        </Row>
      )}
      {ai.provider === "openai" && (catalog === "openrouter" ? (
        <Row title="Structured output" help="Set from what OpenRouter says the model supports.">
          <span style={{ fontSize: 14 }}>{!ai.model ? "Set when you pick a model" : ai.jsonMode === "schema" ? "Strict schema" : "Plain JSON"}</span>
        </Row>
      ) : (
        <Row title="Structured output" help="Strict schema works on most providers. If tests fail with a format error, switch to plain JSON.">
          <Seg opts={[["Strict schema", "schema"], ["Plain JSON", "object"]]} cur={ai.jsonMode} pick={(v) => setAi({ jsonMode: v as Config["ai"]["jsonMode"] })} />
        </Row>
      ))}
        </>
      )}
      {ai.provider === "agent" && aiMsg && <Row title="" help=""><Msg text={aiMsg.text} ok={aiMsg.ok} /></Row>}

      <Section>Web search</Section>
      <Row title="Search engine" help="SearXNG runs on your server next to Lookout and costs nothing. Brave is a paid API that is more consistent.">
        <Seg opts={[["SearXNG (self-hosted)", "searxng"], ["Brave", "brave"], ["Off", "none"]]} cur={search.provider} pick={(v) => setSearch({ provider: v as Config["search"]["provider"] })} />
      </Row>
      {search.provider === "searxng" && (
        <Row title="SearXNG address" help="Inside the server this is http://searxng:8080.">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: 420 }}>
              <input value={search.searxngUrl} onChange={(e) => setSearch({ searxngUrl: e.target.value }, TYPING)} aria-label="SearXNG address" className="f-brick" style={{ ...input, flex: 1, minWidth: 0 }} />
              {searchTest}
            </div>
            {searchMsg && <Msg text={searchMsg.text} ok={searchMsg.ok} />}
          </div>
        </Row>
      )}
      {search.provider === "brave" && (
        <>
          <Row title="Brave API key" help={search.braveKeyHint ? "Saved and encrypted. Replace it to use a different key." : "From api.search.brave.com."}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SecretField label="Brave API key" hint={search.braveKeyHint} value={search.braveKey} onChange={(v) => setSearch({ braveKey: v }, TYPING)} action={searchTest} />
              {searchMsg && <Msg text={searchMsg.text} ok={searchMsg.ok} />}
            </div>
          </Row>
          <Row title="Price per search" help="Dollars per query, for the spend totals.">
            <NumberField label="Per query" value={search.pricePerQuery} onChange={(v) => setSearch({ pricePerQuery: v }, TYPING)} />
          </Row>
        </>
      )}
      {search.provider === "none" && searchMsg && <Row title="" help=""><Msg text={searchMsg.text} ok={searchMsg.ok} /></Row>}

      <Section>Page reading</Section>
      <Row title="Test a link" help="Checks that Lookout can open and read a posting. Private and internal addresses are always refused.">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, maxWidth: 460 }}>
            <input value={fetchUrl} onChange={(e) => setFetchUrl(e.target.value)} placeholder="https://..." aria-label="Link to test" className="f-brick" style={{ ...input, flex: 1, minWidth: 0 }} />
            <button onClick={testFetch} style={btn("outline")}>Test</button>
          </div>
          {fetchMsg && <Msg text={fetchMsg.text} ok={fetchMsg.ok} />}
        </div>
      </Row>
    </div>
  );
}

/** A stored key shows as dots plus its last 4 characters; Replace opens an empty field. */
function SecretField({ label, hint, value, onChange, action }: { label: string; hint: string; value: string; onChange: (v: string) => void; action?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  if (hint && !editing && !value) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: 420 }}>
        <Fixed>
          <span aria-label={`${label} saved, ending in ${hint.slice(-4)}`}>
            <span style={{ letterSpacing: ".12em" }}>••••••••••••</span> {hint.slice(-4)}
          </span>
        </Fixed>
        <button onClick={() => setEditing(true)} style={{ ...btn("outline"), height: 42, flex: "none" }}>Replace</button>
        {action}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: 420 }}>
    <input
      type="password"
      autoComplete="off"
      autoFocus={editing}
      value={value}
      onChange={(e) => {
        // Once typing starts, the field stays open while there's text and returns to dots after it saves.
        setEditing(false);
        onChange(e.target.value);
      }}
      onBlur={() => setEditing(false)}
      placeholder="Paste a key"
      aria-label={label}
      className="f-brick"
      style={{ ...input, flex: 1, minWidth: 0 }}
    />
    {action}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#6B6358" }}>
      {label}
      <input
        inputMode="decimal"
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        }}
        className="f-brick"
        style={{ ...input, width: 140, textTransform: "none", letterSpacing: 0, fontWeight: 500 }}
      />
    </label>
  );
}

type OrModel = { id: string; name: string; context: number; priceIn: number | null; priceOut: number | null; structured: boolean | null };

/** Search a provider's catalog. OpenRouter picks also fill prices and JSON mode. */
function ModelPicker({ source, current, onPick }: { source: Catalog; current: string; onPick: (m: OrModel) => void }) {
  const priced = source === "openrouter";
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<OrModel[] | null>(null);
  const [q, setQ] = useState("");
  const [onlyStructured, setOnlyStructured] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const toggle = () => {
    setOpen((v) => !v);
    if (!models) api<{ models: OrModel[] }>(`/api/admin/models?source=${source}`).then((r) => setModels(r.models)).catch((e) => setErr(e.message));
  };
  const needle = q.trim().toLowerCase();
  const list = (models ?? [])
    .filter((m) => (!priced || !onlyStructured || m.structured) && (!needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)))
    .slice(0, 60);
  const price = (n: number | null) => (n === null ? "" : n === 0 ? "free" : `$${n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 2 : 0)}`);
  return (
    <div style={{ maxWidth: 520 }}>
      <button onClick={toggle} style={{ ...btn("outline"), height: 34, padding: "0 12px", fontSize: 14 }}>{open ? `Hide ${CATALOG_NAME[source]} models` : current ? "Change model" : `Browse ${CATALOG_NAME[source]} models`}</button>
      {open && (
        <div style={{ marginTop: 8, background: "#fff", border: "1.5px solid #E6E0D8", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 10, borderBottom: "1px solid #EEEAE4", flexWrap: "wrap" }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. qwen, deepseek, llama" aria-label="Search models" className="f-brick" style={{ ...input, height: 36, flex: 1, minWidth: 180 }} />
            {priced && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#6B6358" }}>
                <input type="checkbox" checked={onlyStructured} onChange={(e) => setOnlyStructured(e.target.checked)} />
                Structured output only
              </label>
            )}
          </div>
          {err && <div style={{ padding: 12 }}><Msg text={err} /></div>}
          {!models && !err && <div style={{ padding: 12, fontSize: 14, color: "#6B6358" }}>Loading models…</div>}
          {models && (
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 70px 70px", gap: 8, padding: "8px 12px", fontSize: 14, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#6B6358", position: "sticky", top: 0, background: "#fff", borderBottom: "1px solid #EEEAE4" }}>
                <span>{priced ? "Model · cheapest first" : "Model"}</span><span style={{ textAlign: "right" }}>{priced && "In /1M"}</span><span style={{ textAlign: "right" }}>{priced && "Out /1M"}</span>
              </div>
              {list.length === 0 && <div style={{ padding: 12, fontSize: 14, color: "#6B6358" }}>No models match.</div>}
              {list.map((m) => (
                <button key={m.id} className="h-menu" onClick={() => { onPick(m); setOpen(false); }} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 70px 70px", gap: 8, width: "100%", padding: "9px 12px", border: 0, borderBottom: "1px solid #F2EEE8", background: m.id === current ? "#F6F2EC" : "#fff", cursor: "pointer", textAlign: "left", alignItems: "center" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#1D1A0F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                    <span style={{ display: "block", fontSize: 14, color: "#6B6358", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.context ? `${m.id} · ${Math.round(m.context / 1000)}K context` : m.id}</span>
                  </span>
                  <span style={{ fontSize: 14, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{price(m.priceIn)}</span>
                  <span style={{ fontSize: 14, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{price(m.priceOut)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
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
        <span style={{ fontSize: 14, color: "#6B6358" }}>No requests waiting.</span>
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
              <div style={{ fontSize: 14, color: "#6B6358" }}>{r.nextMove ?? "No answer"} · {when(r.createdAt)}</div>
            </div>
            <button onClick={() => decide(r.email, "decline")} className="h-danger" style={{ ...btn("danger"), height: 32, padding: "0 12px", fontSize: 14 }}>Decline</button>
            <button onClick={() => decide(r.email, "approve")} style={{ ...btn("solid"), height: 32, padding: "0 12px", fontSize: 14 }}>Approve</button>
          </div>
        ))}
      </div>
    </Row>
  );
}
