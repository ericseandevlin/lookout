import { describe, expect, it } from "vitest";
import { pickOptions, planFill } from "./fillPlan";

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

describe("pickOptions (#165)", () => {
  const work = [
    "Yes, and I will not require employer support for employment visa status now or in the future for continued employment.",
    "Yes, but I will require employer support for employment visa status in the future for continued employment (if you are currently on H-1B, TN, E-3, or O-1 you will select this answer.)",
    "No, and I will require employer support for employment visa status in the future for continued employment.",
  ];
  it("matches the exact option text", () => {
    expect(pickOptions(work[0], work)).toEqual([work[0]]);
  });
  it("ticks several options, one per line, ignoring case and extra spaces", () => {
    expect(pickOptions(`${work[0].toUpperCase()}\n\n  ${work[2]}  `, work)).toEqual([work[0], work[2]]);
  });
  it("accepts an answer cut short, and drops lines that match nothing", () => {
    expect(pickOptions("Yes, but I will require employer support\nMaybe", work)).toEqual([work[1]]);
  });
  it("uses the answer as-is when the question listed no options", () => {
    expect(pickOptions("Remote", [])).toEqual(["Remote"]);
  });
});

describe("planFill options", () => {
  it("carries a choice item's options to the browser step", () => {
    const [s] = planFill([item({ id: "1", prompt: "Work authorization", options: ["Yes", "No"], approvedVersionId: "v1" })], [{ id: "v1", content: "Yes" }]);
    expect(s.options).toEqual(["Yes", "No"]);
  });
});
