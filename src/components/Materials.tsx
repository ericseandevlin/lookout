"use client";

import { useState } from "react";
import { cleanUrl, hrefOf, LINK_KINDS, LINK_TILE, linkKind } from "@/lib/links";
import { ChevronDown, PencilIcon, TrashIcon } from "./icons";
import { PageHead, ProfileTabs } from "./Profile";
import { useStore } from "./store";
import { useConfirm } from "./Confirm";

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#6B6358" }}>{children}</div>
);

const FIELD_NAMES: Record<string, string> = { q1: "next role", area: "where you work", modes: "work modes", q4: "lead win" };

function statusLine(note: string) {
  if (!note) return "Saved";
  const n = note.replace(/^saved,?\s*/i, "");
  if (/^filled /i.test(n)) return `Saved · Filled ${n.slice(7)} on your profile`;
  return `Saved · ${n.charAt(0).toUpperCase()}${n.slice(1)}`;
}

/** LinkedIn won't let apps read profiles, so people upload the PDF LinkedIn makes for them. */
function LinkedinPdf() {
  const { state, materials: m } = useStore();
  const ask = useConfirm();
  const pdf = state.materials.linkedin.pdf;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    setBusy(true);
    try {
      await m.uploadLinkedinPdf(f);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Couldn't upload that file");
    } finally {
      setBusy(false);
    }
  };
  const picker = (label: string) => (
    <label className="h-border" style={{ display: "inline-flex", alignItems: "center", height: 34, padding: "0 13px", borderRadius: 8, border: "1.5px solid #1D1A0F", background: "#fff", fontSize: 14, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, alignSelf: "flex-start" }}>
      <input type="file" accept=".pdf,application/pdf" onChange={onFile} disabled={busy} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
      {busy ? "Reading…" : label}
    </label>
  );

  if (pdf) {
    const when = new Date(pdf.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 12, background: "#fff", border: "1.5px solid #E6E0D8" }}>
          <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <a href="/api/materials/linkedin/pdf" target="_blank" rel="noopener" className="h-link" style={{ fontSize: 14, fontWeight: 600, color: "#1D1A0F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}>{pdf.name}</a>
            <span style={{ fontSize: 14, color: "#6B6358" }}>LinkedIn profile PDF · uploaded {when} · read on every search</span>
          </div>
          {picker("Replace")}
          <button
            aria-label="Delete LinkedIn PDF"
            data-tip="Delete LinkedIn PDF"
            className="h-border"
            onClick={async () => {
              const ok = await ask({ eyebrow: "Delete LinkedIn PDF", title: `Delete ${pdf.name}?`, body: "The file and its text are removed. Searches will use your resume and answers.", confirmLabel: "Delete", danger: true });
              if (ok) m.deleteLinkedinPdf();
            }}
            style={{ width: 32, height: 32, flex: "none", borderRadius: 8, border: "1.5px solid #E6E0D8", background: "#fff", color: "#6B6358", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
          >
            <TrashIcon />
          </button>
        </div>
        {err && <span role="alert" style={{ fontSize: 14, color: "#99220F" }}>{err}</span>}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 12, background: "#FBF8F4", border: "1.5px solid #EEEAE4" }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Add your full LinkedIn profile</div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#6B6358", textWrap: "pretty" }}>
        LinkedIn doesn&apos;t let apps read profiles, so have LinkedIn save yours as a PDF and upload it here. Lookout reads your full history from it.
      </p>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6, color: "#3B362C" }}>
        <li>On a computer, open <a href="https://www.linkedin.com/in/me/" target="_blank" rel="noopener noreferrer" style={{ color: "#99220F" }}>your LinkedIn profile</a>.</li>
        <li>In the row of buttons under your headline (<b>Open to</b>, <b>Add section</b>…), click the round <b>⋯</b> button at the end.</li>
        <li>Click <b>Save to PDF</b>. It downloads right away.</li>
        <li>Upload that file here.</li>
      </ol>
      {picker("Upload LinkedIn PDF")}
      {err && <span role="alert" style={{ fontSize: 14, color: "#99220F" }}>{err}</span>}
    </div>
  );
}

export function Materials() {
  const { state, materials: m } = useStore();
  const ask = useConfirm();
  const { resume, links } = state.materials;
  const rs = resume?.status;
  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [kindMenu, setKindMenu] = useState<string | null>(null);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) m.uploadResume(f);
  };
  const add = () => {
    const u = draft.trim();
    if (!u) return;
    m.addLink(u);
    setDraft("");
  };
  const saveEdit = () => {
    if (!editId) return;
    const v = editDraft.trim();
    if (v) m.updateLink(editId, { url: v });
    else m.removeLink(editId);
    setEditId(null);
  };
  const uploaded = resume ? new Date(resume.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

  return (
    <div className="page-pad lk-page" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
      <ProfileTabs />
      <PageHead
        eyebrow="Materials"
        title="Resume, LinkedIn and links"
        intro="Lookout reads these to understand your background, so it can fill in your search profile and judge which roles fit. Changes save automatically."
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 26, paddingTop: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>Resume</SectionLabel>
          <p style={{ margin: "0 0 4px", fontSize: 14, lineHeight: 1.5, color: "#6B6358", textWrap: "pretty" }}>
            Lookout keeps the text of your resume with your account and uses it two ways. It fills any profile answers you left empty (next role,
            where you work, work modes, your lead win); those get a &ldquo;Filled from resume&rdquo; tag and are yours to edit. And every search
            reads it to judge fit. It never overwrites an answer you wrote. Deleting the resume removes the file and its text.
          </p>
          <label className="h-border" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: rs ? "14px" : "22px 14px", border: "1.5px dashed #D0C7BA", background: "#fff", borderRadius: 12, cursor: "pointer", textAlign: "center" }}>
            <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={onFile} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>{rs ? "Upload a new resume" : "Upload resume"}</span>
            <span style={{ fontSize: 14, color: "#6B6358" }}>
              {rs === "scanning" ? "PDF or DOCX. Stops the scan below and uses the new file instead." : rs ? "PDF or DOCX. Replaces the one below and rescans your profile." : "PDF or DOCX"}
            </span>
          </label>

          {rs === "scanning" && resume && (
            <div style={{ padding: 14, borderRadius: 12, background: "#fff", border: "1.5px solid #E6E0D8", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Scanning {resume.name}…</div>
              <div style={{ height: 4, borderRadius: 999, background: "#F4F1EC", overflow: "hidden" }}>
                <div className="scan-bar" style={{ height: "100%", width: "40%", background: "#F8A865", borderRadius: 999 }} />
              </div>
            </div>
          )}

          {resume && rs !== "scanning" && (
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: 14, borderRadius: 12, background: "#fff", border: "1.5px solid #E6E0D8" }}>
              <a href="/api/materials/resume" target="_blank" rel="noopener" data-tip="View resume" aria-label="View resume" className="h-border" style={{ width: 64, height: 82, flex: "none", border: "1px solid #E0D9CF", borderRadius: 6, background: "#fff", boxShadow: "0 2px 6px rgba(29,26,15,.08)", padding: "9px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                <Bar w="70%" h={4} c="#1D1A0F" /><Bar w="45%" c="#99220F" /><span style={{ height: 3 }} />
                <Bar w="100%" /><Bar w="92%" /><Bar w="96%" /><span style={{ height: 2 }} />
                <Bar w="40%" c="#CFC6B9" /><Bar w="100%" /><Bar w="84%" /><Bar w="90%" />
              </a>
              <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                <a href="/api/materials/resume" target="_blank" rel="noopener" className="h-link" style={{ fontSize: 14.5, fontWeight: 600, color: "#1D1A0F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}>{resume.name}</a>
                <div style={{ fontSize: 14, color: "#6B6358" }}>Uploaded {uploaded}</div>
                <div style={{ fontSize: 14, color: "#99220F" }}>{rs === "failed" ? `Couldn't read this file · ${resume.filled || "try a PDF or DOCX"}` : statusLine(resume.filled)}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flex: "none" }}>
                <a href="/api/materials/resume" target="_blank" rel="noopener" className="h-ink-border" style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "1.5px solid #E6E0D8", background: "#fff", fontSize: 14, fontWeight: 600, color: "#1D1A0F", display: "flex", alignItems: "center", textDecoration: "none" }}>View</a>
                <button
                  data-tip="Delete resume"
                  aria-label="Delete resume"
                  className="h-border"
                  onClick={async () => {
                    const filled = Object.entries(state.profile.auto).filter(([, src]) => src === "resume").map(([k]) => FIELD_NAMES[k] ?? k);
                    const ok = await ask({
                      eyebrow: "Delete resume",
                      title: `Delete ${resume.name}?`,
                      body: filled.length
                        ? `The file and its text are removed. The answers it filled (${filled.join(", ")}) stay on your profile; edit them anytime.`
                        : "The file and its text are removed from your account. Searches will rely on your profile answers until you upload another.",
                      confirmLabel: "Delete",
                      danger: true,
                    });
                    if (ok) m.deleteResume();
                  }}
                  style={{ width: 32, height: 32, borderRadius: 8, border: "1.5px solid #E6E0D8", background: "#fff", color: "#6B6358", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>LinkedIn</SectionLabel>
          <LinkedinPdf />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>Other links</SectionLabel>
          {links.map((lk) => {
            const auto = linkKind(lk.url);
            const kind = lk.kind || auto;
            const t = LINK_TILE[kind] || LINK_TILE.Other;
            const initial = ["Website", "Other", "Press"].includes(kind) ? (cleanUrl(lk.url)[0] || "W").toUpperCase() : kind[0];
            const editing = editId === lk.id;
            return (
              <div key={lk.id} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, borderRadius: 12, background: "#fff", border: `1.5px solid ${editing ? "#99220F" : "#E6E0D8"}`, padding: "8px 8px 8px 10px" }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: t[0], color: t[1], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flex: "none" }}>{initial}</div>
                {editing ? (
                  <>
                    <input
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditId(null); }}
                      aria-label="Link"
                      style={{ flex: 1, minWidth: 0, height: 34, border: 0, outline: "none", background: "transparent", fontSize: 14, color: "#1D1A0F" }}
                    />
                    <div style={{ display: "flex", gap: 6, flex: "none" }}>
                      <button onClick={() => setEditId(null)} style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "1.5px solid #E6E0D8", background: "#fff", fontSize: 14, fontWeight: 600, color: "#6B6358", cursor: "pointer" }}>Cancel</button>
                      <button onClick={saveEdit} style={{ height: 32, padding: "0 14px", borderRadius: 8, border: 0, background: "#1D1A0F", fontSize: 14, fontWeight: 600, color: "#fff", cursor: "pointer" }}>Save</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                      <div style={{ position: "relative", display: "flex" }}>
                        <button data-tip="Change label" onClick={() => setKindMenu(kindMenu === lk.id ? null : lk.id)} className="h-soft" style={{ display: "flex", alignItems: "center", gap: 4, border: 0, background: "transparent", padding: "1px 0", fontSize: 14, fontWeight: 600, color: "#6B6358", cursor: "pointer" }}>
                          {kind}
                          <ChevronDown size={11} />
                        </button>
                        {kindMenu === lk.id && (
                          <>
                            <div onClick={() => setKindMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 5 }} />
                            <div role="menu" style={{ position: "absolute", top: 22, left: -8, zIndex: 6, background: "#fff", borderRadius: 12, boxShadow: "0 8px 28px rgba(29,26,15,.18)", padding: 6, minWidth: 170, maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                              <KindOption label="Auto-detect" note={auto} on={!lk.kind} pick={() => { m.updateLink(lk.id, { kind: null }); setKindMenu(null); }} />
                              <div style={{ height: 1, background: "#EEEAE4", margin: "4px 6px" }} />
                              {LINK_KINDS.map((k) => (
                                <KindOption key={k} label={k} on={lk.kind === k} pick={() => { m.updateLink(lk.id, { kind: k }); setKindMenu(null); }} />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                      <a href={hrefOf(lk.url)} target="_blank" rel="noopener noreferrer" className="h-link" style={{ fontSize: 14, fontWeight: 500, color: "#1D1A0F", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cleanUrl(lk.url)}</a>
                      {lk.status && (
                        <span style={{ fontSize: 14, color: lk.status === "failed" ? "#99220F" : "#6B6358" }}>
                          {lk.status === "scanning" ? "Reading…" : lk.status === "done" ? "Read · used in searches" : `${lk.note ?? "Couldn't read this page"} · not used in searches`}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 4, flex: "none" }}>
                      <button data-tip="Edit link" aria-label="Edit link" className="h-soft" onClick={() => { setEditId(lk.id); setEditDraft(lk.url); setKindMenu(null); }} style={iconBtn}><PencilIcon /></button>
                      <button data-tip="Delete link" aria-label="Delete link" className="h-danger" onClick={() => m.removeLink(lk.id)} style={iconBtn}><TrashIcon /></button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Website, Instagram, portfolio…"
              aria-label="Add a link"
              maxLength={500}
              className="f-brick"
              style={{ flex: 1, minWidth: 0, height: 40, borderRadius: 10, border: "1.5px solid #E6E0D8", background: "#fff", padding: "0 12px", color: "#1D1A0F", fontSize: 14, outline: "none" }}
            />
            <button onClick={add} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: 0, background: "#1D1A0F", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = { width: 30, height: 30, border: 0, borderRadius: 8, background: "transparent", color: "#6B6358", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 };

const Bar = ({ w, h = 3, c = "#E6E0D8" }: { w: string; h?: number; c?: string }) => (
  <span style={{ display: "block", height: h, width: w, borderRadius: 2, background: c }} />
);

function KindOption({ label, note, on, pick }: { label: string; note?: string; on: boolean; pick: () => void }) {
  return (
    <button role="menuitem" className="h-menu" onClick={pick} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", border: 0, borderRadius: 8, background: on ? "#F6F2EC" : "transparent", fontSize: 14, fontWeight: 500, color: "#1D1A0F", cursor: "pointer", textAlign: "left" }}>
      {label}
      {note && <span style={{ fontSize: 14, color: "#6B6358" }}>{note}</span>}
    </button>
  );
}
