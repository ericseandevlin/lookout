import type { ApplicationItemKind } from "@/lib/db/schema";

/** One thing the browser worker puts into the form: an upload, a choice or typed text. */
export type FillStep = { prompt: string; required: boolean; itemKind: ApplicationItemKind; kind: "file" | "choice" | "text"; content: string; file?: string };

type ItemRow = { id: string; kind: ApplicationItemKind; prompt: string; required: boolean; fieldType: string | null; options: string[] | null; approvedVersionId: string | null };

/** Approved versions only, in form order. Optional items the user didn't approve are left blank on the form. */
export function planFill(items: ItemRow[], versions: { id: string; content: string }[]): FillStep[] {
  const out: FillStep[] = [];
  for (const i of items) {
    // EEO answers never come from item versions; submit.ts adds them from the profile, with consent (#122).
    if (i.kind === "eeo") continue;
    const v = versions.find((x) => x.id === i.approvedVersionId);
    if (!v) continue;
    const kind: FillStep["kind"] = i.kind === "resume" || i.kind === "cover_letter" || i.fieldType === "file" ? "file" : i.options?.length ? "choice" : "text";
    out.push({ prompt: i.prompt, required: i.required, itemKind: i.kind, kind, content: v.content });
  }
  return out;
}
