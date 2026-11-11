import { describe, expect, it } from "vitest";
import { ANSWERS_SYSTEM, answersPrompt, type DraftInputs } from "./draft";
import { asStrategy, LETTER_RULES, LETTER_STRATEGIES, strategyLine, strategyOf } from "./letter";

describe("cover letter approaches (#738)", () => {
  it("writes the approach into a version note and reads it back", () => {
    for (const s of LETTER_STRATEGIES) expect(strategyOf(`- Redrafted from the posting\n${strategyLine(s)}\n- 140 words`)).toBe(s);
    expect(strategyOf("- Redrafted from the posting")).toBeNull();
    expect(strategyOf(null)).toBeNull();
  });

  it("accepts only a known approach from the model", () => {
    expect(asStrategy(" Proof ")).toBe("proof");
    expect(asStrategy("all three")).toBeNull();
    expect(asStrategy(undefined)).toBeNull();
  });

  it("the prompt holds every approach, the 150 word limit and the approach the person asked for", () => {
    for (const s of LETTER_STRATEGIES) expect(ANSWERS_SYSTEM).toContain(`${s}: `);
    expect(ANSWERS_SYSTEM).toContain("150 words or fewer");
    const inp = { name: "Pat", email: "pat@example.com", brief: "", resume: "", links: [], posting: { title: "Designer", company: "Acme", text: "" } } as unknown as DraftInputs;
    const item = { index: 0, kind: "cover_letter" as const, prompt: "Cover letter", required: false, options: null };
    expect(answersPrompt(inp, [item], "plan")).toContain("asked for this cover letter approach: plan");
    expect(answersPrompt(inp, [item])).not.toContain("asked for this cover letter approach");
  });
});

describe("cover letter shape rules (#738)", () => {
  // The recruiter check flags an "I'm applying for" opening, so the prompt must not ask for one.
  it("does not ask for the opening the recruiter check flags", () => {
    expect(LETTER_RULES).not.toMatch(/first sentence names the role/i);
    expect(LETTER_RULES).toMatch(/Never open by saying the person is applying/);
  });

  it("caps the letter at 3 paragraphs and one approach", () => {
    expect(LETTER_RULES).toMatch(/2 or 3 short paragraphs, never more/);
    expect(LETTER_RULES).toMatch(/Do not add a paragraph from another approach/);
  });
});
