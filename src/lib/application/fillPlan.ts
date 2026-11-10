import type { ApplicationItemKind } from "@/lib/db/schema";

/** One thing the browser worker puts into the form: an upload, a choice or typed text. */
export type FillStep = { prompt: string; required: boolean; itemKind: ApplicationItemKind; kind: "file" | "choice" | "text"; content: string; options?: string[]; file?: string };

type ItemRow = { id: string; kind: ApplicationItemKind; prompt: string; required: boolean; fieldType: string | null; options: string[] | null; approvedVersionId: string | null };

/** Approved versions only, in form order. Optional items the user didn't approve are left blank on the form. */
export function planFill(items: ItemRow[], versions: { id: string; content: string }[]): FillStep[] {
  const out: FillStep[] = [];
  for (const i of items) {
    // Outreach is for the person to send themselves; it is never an application-form field.
    if (i.kind === "outreach") continue;
    const v = versions.find((x) => x.id === i.approvedVersionId);
    if (!v) continue;
    const kind: FillStep["kind"] = i.kind === "resume" || i.kind === "cover_letter" || i.fieldType === "file" ? "file" : i.options?.length ? "choice" : "text";
    out.push({ prompt: i.prompt, required: i.required, itemKind: i.kind, kind, content: v.content, ...(i.options?.length ? { options: i.options } : {}) });
  }
  return out;
}

/** a starts b and ends on a word boundary there: "no" starts "no, thanks" but not "none" (#632). */
const startsWord = (a: string, b: string) => b.startsWith(a) && (b.length === a.length || /\W/.test(b[a.length]) || /\W/.test(a[a.length - 1]));

/**
 * Which option labels to tick on a "select any that apply" question (#165). One answer per line.
 * Exact text first, then a prefix match either way, so a long label cut short in the answer still lands.
 * Prefixes stop at a word boundary and the closest length wins, so "None" is "None of the above", not "No" (#632).
 */
export function pickOptions(content: string, options: string[] = []): string[] {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const out: string[] = [];
  for (const part of content.split(/\n+/).map((t) => t.trim()).filter(Boolean)) {
    const p = norm(part);
    const near = options.filter((o) => startsWord(norm(o), p) || startsWord(p, norm(o))).sort((a, b) => Math.abs(norm(a).length - p.length) - Math.abs(norm(b).length - p.length));
    const hit = options.find((o) => norm(o) === p) ?? near[0];
    const label = hit ?? (options.length ? null : part);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}
