import { contactParts, parseDraft, roleParts, styleFor, type Block, type Template } from "./resumeLayout";

/**
 * The resume or letter as HTML: one renderer for the review screen and the PDF, so the PDF a
 * recruiter opens has the same headings in the same order as what the person approved (#106).
 * Real text only, one column: name is the h1, each section an h2, bullets a real list.
 */

export type LetterHeader = { name: string; contact: string; headline?: string };
export type DocOpts = { template: Template; accent?: string | null; header?: LetterHeader | null };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const css = (o: Record<string, string | number | undefined | false>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== false && v !== "")
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
    .join(";");
const safeHref = (h: string) => (/^(https?:|mailto:|tel:)/i.test(h) ? h : "");

/** The blocks shown, with a cover letter's header (the resume's name and contact) on top. */
export function docBlocks(md: string, header?: LetterHeader | null): Block[] {
  const blocks = parseDraft(md);
  const top: Block[] =
    header && blocks[0]?.t !== "name"
      ? [{ t: "name", text: header.name }, ...(header.headline ? [{ t: "headline" as const, text: header.headline }] : []), ...(header.contact ? [{ t: "contact" as const, text: header.contact }] : [])]
      : [];
  return [...top, ...blocks];
}

/** The document body (no page chrome), in the person's template. */
export function docBody(md: string, o: DocOpts): string {
  const T = styleFor(o.template, o.accent);
  const c = (hex: string) => `#${hex}`;
  const center = T.align === "center";
  const all = docBlocks(md, o.header);
  const headerLen = all.length - parseDraft(md).length;
  const out: string[] = [];
  let list = false;
  const closeList = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  all.forEach((b, i) => {
    if (b.t !== "bullet") closeList();
    if (b.t === "name") out.push(`<h1 style="${css({ margin: "0 0 4px", fontSize: `${T.nameSize}px`, fontWeight: T.nameWeight, lineHeight: 1.1, letterSpacing: T.section === "bar" && "-0.02em", textAlign: center ? "center" : "left" })}">${esc(b.text)}</h1>`);
    else if (b.t === "headline")
      out.push(`<div style="${css({ fontSize: "16px", fontStyle: T.headlineItalic ? "italic" : "normal", fontWeight: T.section === "bar" ? 700 : 400, color: T.section === "bar" ? c(T.accent) : c(T.ink), textAlign: center ? "center" : "left", marginBottom: "4px" })}">${esc(b.text)}</div>`);
    else if (b.t === "contact") {
      const parts = contactParts(b.text).map((p) => {
        const href = p.href ? safeHref(p.href) : "";
        return href ? `<a href="${esc(href)}"${href.startsWith("http") ? ' target="_blank" rel="noreferrer"' : ""} style="color:${c(T.accent)}">${esc(p.text)}</a>` : esc(p.text);
      });
      out.push(`<div style="${css({ fontSize: "12.5px", color: c(T.muted), textAlign: center ? "center" : "left", marginBottom: headerLen && i === headerLen - 1 ? "22px" : 0 })}">${parts.join('<span aria-hidden="true"> • </span>')}</div>`);
    } else if (b.t === "section")
      out.push(
        `<h2 style="${css({
          fontSize: "13.5px",
          fontWeight: 700,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: T.section === "rule" ? c(T.ink) : c(T.accent),
          textAlign: T.section === "rule" && center ? "center" : "left",
          margin: "18px 0 6px",
          ...(T.section === "rule" ? { borderBottom: "1px solid #999", paddingBottom: "2px" } : T.section === "bar" ? { borderLeft: `4px solid ${c(T.accent)}`, paddingLeft: "8px" } : {}),
          breakAfter: "avoid",
        })}">${esc(b.text)}</h2>`,
      );
    else if (b.t === "role" || b.t === "subrole") {
      const sub = b.t === "subrole";
      const r = roleParts(all, i);
      const left = sub ? esc(b.text) : T.section === "bar" && r.title ? `<span style="color:${c(T.accent)}">${esc(r.title)}</span>${esc(r.rest)}` : esc(b.text);
      const style = sub
        ? css({ display: "flex", flexWrap: "wrap", gap: "0 12px", justifyContent: "space-between", fontWeight: 600, fontStyle: T.headlineItalic ? "italic" : "normal", color: T.section === "bar" ? c(T.accent) : c(T.ink), margin: "6px 0 2px", breakAfter: "avoid" })
        : css({ display: "flex", flexWrap: "wrap", gap: "0 12px", justifyContent: "space-between", fontWeight: 700, margin: "10px 0 2px", breakAfter: "avoid" });
      out.push(`<div style="${style}"><span>${left}</span>${b.right ? `<span style="${css({ fontWeight: 400, fontStyle: "normal", color: c(T.muted), whiteSpace: "nowrap" })}">${esc(b.right)}</span>` : ""}</div>`);
    } else if (b.t === "bullet") {
      if (!list) out.push(`<ul style="${css({ margin: "1px 0", paddingLeft: "18px" })}">`);
      list = true;
      out.push(`<li style="margin:1px 0">${esc(b.text)}</li>`);
    } else out.push(`<p style="margin:0 0 8px">${esc(b.text)}</p>`);
  });
  closeList();
  const marker = T.section === "bar" ? `<style>.lk-doc-${T.accent} li::marker{color:${c(T.accent)}}</style>` : "";
  return `${marker}<div class="lk-doc lk-doc-${T.accent}" style="${css({ fontFamily: T.css, color: c(T.ink), fontSize: "13.5px", lineHeight: 1.45, overflowWrap: "anywhere" })}">${out.join("")}</div>`;
}

/** A whole page for printing to PDF: US Letter, the .docx's margins. */
export function docPage(md: string, o: DocOpts & { title: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>@page{size:Letter;margin:0.625in 0.75in}html,body{margin:0;padding:0;background:#fff}a{text-decoration:none}</style></head><body>${docBody(md, o)}</body></html>`;
}
