"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SearchProfile } from "@/lib/db/schema";
import { PageHead, ProfileTabs } from "./Profile";
import { btn } from "./Settings";
import { api } from "./store";

type Data = {
  profile: SearchProfile | null;
  builtAt: string | null;
  sources: { answers: number; resume: boolean; linkedin: boolean; links: number; notes: number };
  stale: boolean;
  canBuild: boolean;
  error: string | null;
};

const sourceLine = (s: Data["sources"]) => {
  const parts = [
    s.answers && `${s.answers} ${s.answers === 1 ? "answer" : "answers"}`,
    s.resume && "your resume",
    s.linkedin && "your LinkedIn PDF",
    s.links && `${s.links} ${s.links === 1 ? "link" : "links"}`,
    s.notes && `your notes on ${s.notes} ${s.notes === 1 ? "find" : "finds"}`,
  ].filter(Boolean) as string[];
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "nothing yet");
};

/** Profile > What Lookout sees: the search profile every search uses, in plain view. */
export function SearchProfileView() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Data>("/api/search-profile").then(setData).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load it"));
  }, []);

  const rebuild = async () => {
    setBusy(true);
    setErr(null);
    try {
      setData(await api<Data>("/api/search-profile", { method: "POST" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't rebuild it");
    } finally {
      setBusy(false);
    }
  };

  const p = data?.profile;
  const when = data?.builtAt ? new Date(data.builtAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  return (
    <div className="page-pad lk-page" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <ProfileTabs />
      <PageHead
        eyebrow="Search profile"
        title="What Lookout sees"
        intro="Every search works from this picture of you. Lookout builds it from your answers and materials and updates it when they change. To change it, edit those; each section links to the right place."
      />

      {!data && !err && (
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Reading your answers and materials…</div>
          <div style={{ height: 4, borderRadius: 999, background: "#F4F1EC", overflow: "hidden" }}>
            <div className="scan-bar" style={{ height: "100%", width: "40%", background: "#F8A865", borderRadius: 999 }} />
          </div>
          <div style={{ fontSize: 14, color: "#6B6358" }}>This takes a few seconds the first time, and after you change something.</div>
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 14, color: "#99220F" }}>{err}</div>}

      {data && !p && (
        <div style={{ ...card, fontSize: 14, lineHeight: 1.5, color: "#3B362C" }}>
          {data.sources.answers || data.sources.resume || data.sources.linkedin ? (
            data.canBuild ? "Lookout couldn't build your profile just now. Try Rebuild in a minute." : "Lookout builds this with its AI model, which isn't set up yet. Your answers and materials are still used on every search."
          ) : (
            <>
              Nothing to work from yet. <Link href="/profile" style={{ color: "#99220F" }}>Answer the five questions</Link> or{" "}
              <Link href="/profile/materials" style={{ color: "#99220F" }}>add your resume</Link>, and this fills in.
            </>
          )}
        </div>
      )}

      {data && p && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 14, color: "#6B6358" }}>
            <span>
              Built {when} from {sourceLine(data.sources)}.
              {data.stale && " Your changes since then will be picked up on the next search."}
              {data.error && ` ${data.error}.`}
            </span>
            {data.canBuild && (
              <button onClick={rebuild} disabled={busy} style={{ ...btn("text"), height: 28, fontSize: 14 }}>{busy ? "Rebuilding…" : "Rebuild"}</button>
            )}
          </div>

          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 22 }}>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, fontWeight: 500, textWrap: "pretty" }}>{p.summary}</p>

            <Part title="Searches for" edit={["/profile#q-q1", "Edit your next role"]}>
              <Chips items={p.targetTitles} strong />
              <div style={{ fontSize: 14, color: "#6B6358", marginTop: 8 }}>Level: {p.seniority}</div>
            </Part>
            {p.industries.length > 0 && (
              <Part title="Industries" edit={["/profile#q-q1", "Edit your next role"]}>
                <Chips items={p.industries} />
              </Part>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 22 }}>
              <Part title="Where" edit={["/profile#q-where", "Edit"]}>
                <div style={{ fontSize: 14.5 }}>{p.where}</div>
              </Part>
              <Part title="Pay" edit={["/profile#q-comp", "Edit"]}>
                <div style={{ fontSize: 14.5 }}>{p.pay}</div>
              </Part>
            </div>
            <Part title="What employers will see in you" edit={["/profile/materials", "Edit materials"]}>
              <List items={p.strengths} />
            </Part>
            {p.proof.length > 0 && (
              <Part title="Results it leads with" edit={["/profile#q-q4", "Edit your win"]}>
                <List items={p.proof} />
              </Part>
            )}
            {p.avoid.length > 0 && (
              <Part title="Rules out" edit={["/profile#q-q5", "Edit dealbreakers"]}>
                <Chips items={p.avoid} muted />
              </Part>
            )}
            {(p.corrections?.length ?? 0) > 0 && (
              <Part title="What you've corrected" edit={["/finds", "From your notes"]}>
                <List items={p.corrections!} />
              </Part>
            )}
            <Part title="Words it looks for in postings">
              <Chips items={p.searchTerms} muted />
            </Part>
          </div>
        </>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1.5px solid #E6E0D8", borderRadius: 14, padding: 20 };

function Part({ title, edit, children }: { title: string; edit?: [string, string]; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "#6B6358" }}>{title}</h2>
        {edit && (
          <Link href={edit[0]} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#99220F", textDecoration: "none", whiteSpace: "nowrap" }}>{edit[1]} →</Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Chips({ items, strong, muted }: { items: string[]; strong?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.map((t) => (
        <span key={t} style={{ padding: "5px 11px", borderRadius: 999, fontSize: 14, fontWeight: strong ? 600 : 500, background: strong ? "#1D1A0F" : muted ? "#F4F1EC" : "#FDE7D3", color: strong ? "#fff" : muted ? "#3B362C" : "#7A3A10" }}>{t}</span>
      ))}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5, fontSize: 14, lineHeight: 1.45 }}>
      {items.map((t) => <li key={t}>{t}</li>)}
    </ul>
  );
}
