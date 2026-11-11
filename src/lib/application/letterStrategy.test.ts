import { describe, expect, it } from "vitest";
import type { PersonalStory } from "@/lib/db/schema";
import { fittingStory, isStrategy, suggestStrategy } from "./letterStrategy";
import { answersPrompt, type DraftInputs } from "./draft";

const story = (theme: PersonalStory["theme"], text = "My mother's care team changed how I think about software."): PersonalStory => ({ id: "s1", theme, story: text, updatedAt: "2026-11-01" });

describe("cover letter strategies (#738)", () => {
  it("suggests why-this-team when a story's theme runs through the posting", () => {
    const posting = { title: "Product Designer", text: "We build tools for patients and their care teams. Clinical staff rely on us." };
    expect(fittingStory([story("health")], posting.text)?.id).toBe("s1");
    expect(suggestStrategy(posting, [story("health")]).strategy).toBe("why");
  });

  it("needs two theme hits, not one passing mention", () => {
    expect(fittingStory([story("health")], "We offer health insurance.")).toBeNull();
  });

  it("suggests lead-with-proof for senior roles and match-the-asks otherwise", () => {
    expect(suggestStrategy({ title: "Senior Design Engineer", text: "Build things." }, []).strategy).toBe("proof");
    expect(suggestStrategy({ title: "Director, UX Engineering", text: "Build things." }, []).strategy).toBe("proof");
    expect(suggestStrategy({ title: "Design Engineer", text: "Build things." }, []).strategy).toBe("match");
  });

  it("checks strategy names", () => {
    expect(isStrategy("proof")).toBe(true);
    expect(isStrategy("bold")).toBe(false);
  });

  it("puts the chosen strategy's rule in the prompt only when a cover letter is drafted", () => {
    const inp: DraftInputs = { name: "A", email: "a@x.co", linkedinUrl: null, links: [], brief: "", resume: "", posting: { company: "Co", title: "Designer", text: "" }, letterStrategy: "why" };
    expect(answersPrompt(inp, [{ index: 0, kind: "cover_letter", prompt: "Cover letter", required: false }])).toContain("Cover letter strategy: why this team.");
    expect(answersPrompt(inp, [{ index: 0, kind: "answer", prompt: "Why us?", required: false }])).not.toContain("Cover letter strategy");
  });
});
