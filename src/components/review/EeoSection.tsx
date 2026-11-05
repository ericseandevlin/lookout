"use client";

import Link from "next/link";
import { card, muted, type Act, type Detail } from "./shared";

/** Voluntary EEO questions (#122): filled only from the person's own answers, with their permission. */
export function EeoSection({ d, act }: { d: Detail; act: Act }) {
  const qs = d.items.filter((i) => i.kind === "eeo");
  if (!d.eeoConsent)
    return (
      <div style={{ ...card, ...muted }}>
        This form has {qs.length} voluntary EEO question{qs.length === 1 ? "" : "s"} (gender, race, veteran and disability status). Lookout leaves them blank. To have Lookout answer them from your own answers, set them up in <Link href="/profile/application">Profile › Application answers</Link>.
      </div>
    );
  return (
    <section aria-labelledby="eeo" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 id="eeo" style={{ margin: "6px 0 0", fontSize: 18, fontWeight: 700 }}>Voluntary questions (EEO)</h2>
      <div style={{ ...muted, marginTop: -4 }}>From your answers on your profile. Never shared with an AI. Change one here and Lookout remembers it for this wording.</div>
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
        {qs.map((q) => (
          <div key={q.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label htmlFor={`eeo-${q.id}`} style={{ fontSize: 15, fontWeight: 600 }}>{q.prompt}</label>
            <select
              id={`eeo-${q.id}`}
              value={q.eeoAnswer ?? ""}
              onChange={(e) => act(q.id, { action: "edit", content: e.target.value, note: "" }, "Saved for this wording.")}
              style={{ height: 40, borderRadius: 10, border: "1.5px solid #E0D9CF", padding: "0 10px", fontSize: 15, maxWidth: 520 }}
            >
              <option value="">Leave blank</option>
              {(q.options ?? []).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <div style={muted}>{q.eeoAnswer ? "✓ Will be filled" : "Blank. Lookout couldn't match your answer to this wording; pick one or leave it blank."}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
