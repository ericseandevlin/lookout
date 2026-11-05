"use client";

import { useState } from "react";
import { toPlain as toPlainText } from "@/lib/application/resumeLayout";
import { btn } from "../Settings";
import { card, muted, type Detail } from "./shared";

export function Checklist({ d, onDone }: { d: Detail; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const locked = d.status === "submitted";
  const rows = locked
    ? (d.confirmation?.sent ?? []).map((s, n) => ({ key: String(n), prompt: s.prompt, kind: d.items.find((i) => i.prompt === s.prompt)?.kind ?? "answer", content: s.content }))
    : d.items
        .filter((i) => i.kind !== "outreach" && i.approvedVersionId)
        .map((i) => ({ key: i.id, prompt: i.prompt, kind: i.kind, content: i.versions.find((v) => v.id === i.approvedVersionId)?.content ?? "" }));
  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };
  const download = (prompt: string, text: string) => {
    const url = URL.createObjectURL(new Blob([toPlainText(text)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${d.company} - ${prompt}.txt`.replace(/[\\/:*?"<>|]/g, "-");
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section aria-labelledby="send" style={{ ...card, borderColor: locked ? "#9CC68E" : "#1D1A0F", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 id="send" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{locked ? "What you sent" : "Send it"}</h2>
      {locked ? (
        <p style={{ ...muted, margin: 0 }}>Applied {d.submittedAt ? new Date(d.submittedAt).toLocaleString() : ""}. This is the exact text you approved.</p>
      ) : (
        <p style={{ ...muted, margin: 0 }}>
          Open the application, then copy each answer in. Upload the resume and cover letter as Word files where the form asks for them. Takes about two minutes.
        </p>
      )}
      {!locked && d.report.applyUrl && (
        <a href={d.report.applyUrl} target="_blank" rel="noreferrer" style={{ ...btn("solid"), display: "inline-flex", alignItems: "center", alignSelf: "flex-start", textDecoration: "none" }}>
          Open the application ↗
        </a>
      )}
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <li key={r.key} style={{ fontSize: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 200px", fontWeight: 600 }}>{r.prompt}</span>
              <button onClick={() => copy(r.key, r.kind === "resume" || r.kind === "cover_letter" ? toPlainText(r.content) : r.content)} style={{ ...btn("outline"), height: 32 }}>
                {copied === r.key ? "Copied" : "Copy"}
              </button>
              {(r.kind === "resume" || r.kind === "cover_letter") && !locked && (
                <>
                  <a href={`/api/apply/${d.id}/items/${r.key}/docx`} title="The file Lookout uploads" download style={{ ...btn("solid"), height: 32, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                    Download .docx
                  </a>
                  <button onClick={() => download(r.prompt, r.content)} style={{ ...btn("outline"), height: 32 }}>
                    .txt
                  </button>
                </>
              )}
            </div>
            {r.kind !== "resume" && r.kind !== "cover_letter" && <div style={{ ...muted, whiteSpace: "pre-wrap", marginTop: 2 }}>{r.content.length > 240 ? `${r.content.slice(0, 240)}…` : r.content}</div>}
          </li>
        ))}
      </ol>
      {!locked && d.eeoConsent && d.items.some((i) => i.kind === "eeo" && i.eeoAnswer) && (
        <div style={{ fontSize: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Voluntary EEO (pick these in the form)</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "#3B362C" }}>
            {d.items
              .filter((i) => i.kind === "eeo" && i.eeoAnswer)
              .map((i) => (
                <li key={i.id}>
                  {i.prompt}: {i.eeoAnswer}
                </li>
              ))}
          </ul>
        </div>
      )}
      {!locked && (
        <button onClick={onDone} style={{ ...btn("outline"), alignSelf: "flex-start" }}>
          I submitted it
        </button>
      )}
    </section>
  );
}
