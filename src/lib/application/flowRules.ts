import type { ApplicationItemKind, ApplicationStatus } from "@/lib/db/schema";

type ReviewItem = { required: boolean; approvedVersionId: string | null };
type Route = "api" | "browser" | "manual" | null;

/** Required items all approved: ready to send. Empty applications never are. */
export function settledStatus(route: Route, items: ReviewItem[], autoSubmit: boolean): Extract<ApplicationStatus, "needs_review" | "approved" | "manual"> {
  const ready = items.length > 0 && items.every((item) => !item.required || item.approvedVersionId);
  if (!ready) return "needs_review";
  return route === "browser" && autoSubmit ? "approved" : "manual";
}

/** Choice questions accept exactly one form option, or an empty answer to clear it. Select-any questions take one option per line (#624). */
export function optionAnswerAllowed(options: string[] | null, content: string, multi = false): boolean {
  if (!options?.length || !content) return true;
  return multi ? content.split("\n").every((line) => options.includes(line)) : options.includes(content);
}

/** Basic fields need no separate review once they have an answer. */
export function autoApproveField(kind: ApplicationItemKind, content: string): boolean {
  return kind === "field" && !!content.trim();
}

/** A browser fill counts as sent only with a confirmation and no stop reason. */
export function statusAfterFill(fill: { confirmation?: string; stopped?: string }): Extract<ApplicationStatus, "submitted" | "manual"> {
  return fill.confirmation !== undefined && !fill.stopped ? "submitted" : "manual";
}
