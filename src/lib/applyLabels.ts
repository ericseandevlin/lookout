import type { ApplicationStatus } from "@/lib/db/schema";

/** Status words and colors for auto-apply, shared by the board and the Auto-apply page. */
export function applicationLabel(status: ApplicationStatus, queuedBy: "user" | "auto") {
  const S: Record<ApplicationStatus, [string, string, string]> = {
    queued: [queuedBy === "auto" ? "Auto-queued" : "Queued", "#F4F1EC", "#3B362C"],
    scanning: ["Reading the application", "#FDE7D3", "#7A3A10"],
    drafting: ["Drafting", "#FDE7D3", "#7A3A10"],
    needs_review: ["Ready for your review", "#FCEBD7", "#7A3A10"],
    approved: ["Approved, ready to send", "#E3EFDD", "#35662A"],
    submitting: ["Sending", "#E3EFDD", "#35662A"],
    submitted: ["Applied", "#E3EFDD", "#35662A"],
    manual: ["Finish by hand", "#FBEDEA", "#99220F"],
    failed: ["Didn't work", "#FBEDEA", "#99220F"],
    canceled: ["Canceled", "#EEEAE4", "#5E574D"],
  };
  const [label, bg, ink] = S[status];
  return { label, bg, ink };
}
