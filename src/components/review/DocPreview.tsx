"use client";

import { contactParts, parseDraft, roleParts, styleFor, type Block, type Template } from "@/lib/application/resumeLayout";

/** The resume or letter as the recruiter sees it: same layout as the .docx Lookout uploads. */
export function DocPreview({ md, template, accent, header }: { md: string; template: Template; accent?: string | null; header?: { name: string; contact: string; headline?: string } | null }) {
  const T = styleFor(template, accent);
  const c = (hex: string) => `#${hex}`;
  const blocks = parseDraft(md);
  // A cover letter carries the resume's header, so both files match.
  const top: Block[] = header && blocks[0]?.t !== "name" ? [{ t: "name", text: header.name }, ...(header.headline ? [{ t: "headline" as const, text: header.headline }] : []), ...(header.contact ? [{ t: "contact" as const, text: header.contact }] : [])] : [];
  const center = T.align === "center";
  return (
    <div style={{ background: "#fff", border: "1px solid #E0D9CF", borderRadius: 6, boxShadow: "0 2px 10px rgba(29,26,15,.08)", padding: "clamp(18px, 5%, 36px) clamp(16px, 6%, 44px)", fontFamily: T.css, color: c(T.ink), fontSize: 13.5, lineHeight: 1.45, maxHeight: 640, overflow: "auto", overflowWrap: "anywhere" }}>
      {[...top, ...blocks].map((b, i, all) =>
        b.t === "name" ? (
          <div key={i} style={{ fontSize: T.nameSize, fontWeight: T.nameWeight, lineHeight: 1.1, letterSpacing: T.section === "bar" ? "-0.02em" : undefined, textAlign: center ? "center" : "left", marginBottom: 4 }}>{b.text}</div>
        ) : b.t === "headline" ? (
          <div key={i} style={{ fontSize: 16, fontStyle: T.headlineItalic ? "italic" : "normal", fontWeight: T.section === "bar" ? 700 : 400, color: T.section === "bar" ? c(T.accent) : c(T.ink), textAlign: center ? "center" : "left", marginBottom: 4 }}>{b.text}</div>
        ) : b.t === "contact" ? (
          <div key={i} style={{ fontSize: 12.5, color: c(T.muted), textAlign: center ? "center" : "left", marginBottom: top.length && i === top.length - 1 ? 22 : 0 }}>
            {contactParts(b.text).map((p, j) => (
              <span key={j}>
                {j > 0 && <span aria-hidden> • </span>}
                {p.href ? (
                  <a href={p.href} target={p.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" style={{ color: c(T.accent) }}>
                    {p.text}
                  </a>
                ) : (
                  p.text
                )}
              </span>
            ))}
          </div>
        ) : b.t === "section" ? (
          <div
            key={i}
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: T.section === "rule" ? c(T.ink) : c(T.accent),
              textAlign: T.section === "rule" && center ? "center" : "left",
              margin: "18px 0 6px",
              ...(T.section === "rule" ? { borderBottom: "1px solid #999", paddingBottom: 2 } : T.section === "bar" ? { borderLeft: `4px solid ${c(T.accent)}`, paddingLeft: 8 } : {}),
            }}
          >
            {b.text}
          </div>
        ) : b.t === "role" ? (
          <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: "0 12px", justifyContent: "space-between", fontWeight: 700, margin: "10px 0 2px" }}>
            {T.section === "bar" ? (
              <span>
                <span style={{ color: c(T.accent) }}>{roleParts(all, i).title}</span>
                {roleParts(all, i).rest}
              </span>
            ) : (
              <span>{b.text}</span>
            )}
            {b.right && <span style={{ fontWeight: 400, color: c(T.muted), whiteSpace: "nowrap" }}>{b.right}</span>}
          </div>
        ) : b.t === "subrole" ? (
          <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: "0 12px", justifyContent: "space-between", fontWeight: 600, fontStyle: T.headlineItalic ? "italic" : "normal", color: T.section === "bar" ? c(T.accent) : c(T.ink), margin: "6px 0 2px" }}>
            <span>{b.text}</span>
            {b.right && <span style={{ fontWeight: 400, fontStyle: "normal", color: c(T.muted), whiteSpace: "nowrap" }}>{b.right}</span>}
          </div>
        ) : b.t === "bullet" ? (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "14px 1fr", margin: "1px 0" }}>
            <span aria-hidden style={{ color: T.section === "bar" ? c(T.accent) : undefined }}>•</span>
            <span>{b.text}</span>
          </div>
        ) : (
          <p key={i} style={{ margin: "0 0 8px" }}>{b.text}</p>
        ),
      )}
    </div>
  );
}
