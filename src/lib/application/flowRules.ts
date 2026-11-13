import type { ApplicationItemKind, ApplicationStatus } from "@/lib/db/schema";

type ReviewItem = { required: boolean; approvedVersionId: string | null };
type Route = "api" | "browser" | "manual" | null;

/**
 * Required items all approved: ready to send. Empty applications never are.
 * sentMaybe: Lookout already clicked Submit on this application without seeing a confirmation, so it may have gone
 * through. It stays on the manual checklist and Submit for me never turns back on, or it could be sent twice (#865).
 */
export function settledStatus(route: Route, items: ReviewItem[], autoSubmit: boolean, sentMaybe = false): Extract<ApplicationStatus, "needs_review" | "approved" | "manual"> {
  const ready = items.length > 0 && items.every((item) => !item.required || item.approvedVersionId);
  if (!ready) return "needs_review";
  return route === "browser" && autoSubmit && !sentMaybe ? "approved" : "manual";
}

/**
 * Whether a fill report is a real submit where Lookout clicked Submit (#865). finalUrl is only set after the click, so
 * reports from before `clicked` existed still count. A stop before the click (a field it couldn't fill) can be retried.
 */
export function submitClicked(fill: { mode?: string; clicked?: boolean; finalUrl?: string } | null | undefined): boolean {
  return !!fill && fill.mode === "submit" && (!!fill.clicked || fill.finalUrl !== undefined);
}

/** Choice questions accept exactly one form option, or an empty answer to clear it. Select-any questions take one option per line (#624). */
export function optionAnswerAllowed(options: string[] | null, content: string, multi = false): boolean {
  if (!options?.length || !content) return true;
  return multi ? content.split("\n").every((line) => options.includes(line)) : options.includes(content);
}

/** Tick or untick one option on a select-any answer (#627): one option per line, kept in form order. */
export function toggleOption(content: string, options: string[], option: string): string {
  const picked = new Set(content.split("\n").filter(Boolean));
  if (picked.has(option)) picked.delete(option);
  else picked.add(option);
  return options.filter((o) => picked.has(o)).join("\n");
}

/** Basic fields need no separate review once they have an answer. */
export function autoApproveField(kind: ApplicationItemKind, content: string): boolean {
  return kind === "field" && !!content.trim();
}

/** A browser fill counts as sent only with a confirmation and no stop reason. */
export function statusAfterFill(fill: { confirmation?: string; stopped?: string }): Extract<ApplicationStatus, "submitted" | "manual"> {
  return fill.confirmation !== undefined && !fill.stopped ? "submitted" : "manual";
}
