import { describe, expect, it } from "vitest";
import { planFill } from "./fillPlan";

const item = (o: Partial<Parameters<typeof planFill>[0][number]>) => ({ id: "i", kind: "answer" as const, prompt: "Q", required: true, fieldType: "text", options: null, approvedVersionId: null, ...o });

describe("planFill", () => {
  it("uploads resume and cover letter, picks choices, types the rest, skips unapproved", () => {
    const steps = planFill(
      [
        item({ id: "1", kind: "resume", prompt: "Resume/CV", approvedVersionId: "v1" }),
        item({ id: "2", kind: "cover_letter", prompt: "Cover Letter", required: false, approvedVersionId: null }),
        item({ id: "3", prompt: "Sponsorship?", options: ["Yes", "No"], approvedVersionId: "v3" }),
        item({ id: "4", kind: "field", prompt: "Email", approvedVersionId: "v4" }),
      ],
      [
        { id: "v1", content: "# Maya" },
        { id: "v3", content: "No" },
        { id: "v4", content: "maya@example.com" },
      ],
    );
    expect(steps.map((s) => [s.prompt, s.kind, s.content])).toEqual([
      ["Resume/CV", "file", "# Maya"],
      ["Sponsorship?", "choice", "No"],
      ["Email", "text", "maya@example.com"],
    ]);
  });
});
